use std::collections::HashMap;
use std::convert::Infallible;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use autentik_macros::labeled_enum;
use axum::async_trait;
use axum::extract::{FromRequestParts, Path};
use axum::http::request::Parts;
use tokio::sync::OwnedMutexGuard;
use crate::{
    error::AppError,
    AppState,
};
use crate::routes::api_models::{Group, GroupRole, User};

labeled_enum! {
    pub enum PathParams {
        GroupName => "group_name",
        Username => "username",
        ChildGroupName => "child_group_name",
    }
}

pub struct GroupFromPath<PP: PathParamsVariant> {
    pub group: Group,
    pub _p: std::marker::PhantomData<PP>,
}

pub struct UserFromPath<PP: PathParamsVariant> {
    pub user: User,
    pub _p: std::marker::PhantomData<PP>,
}


impl<PP: PathParamsVariant> FromRequestParts<AppState> for GroupFromPath<PP> {
    type Rejection = AppError;

    fn from_request_parts<'life0, 'life1, 'async_trait>(
        parts: &'life0 mut axum::http::request::Parts,
        state: &'life1 AppState,
    ) -> ::core::pin::Pin<
        Box<
            dyn ::core::future::Future<Output = Result<Self, Self::Rejection>>
                + ::core::marker::Send
                + 'async_trait,
        >,
    >
    where
        'life0: 'async_trait,
        'life1: 'async_trait,
        Self: 'async_trait,
    {
        Box::pin(async move {
            let Path(params) = Path::<HashMap<String, String>>::from_request_parts(parts, state)
                .await
                .map_err(|_| AppError::BadRequest("missing path params".to_string()))?;
            let group_name = params.get(PP::to_static_str()).ok_or_else(|| {
                AppError::BadRequest(format!("missing `{}` parameter", PP::to_static_str()))
            })?;
            Ok(GroupFromPath {
                group: state.authentik_state.get_group_by_name(&group_name).await?,
                _p: std::marker::PhantomData,
            })
        })
    }
}

impl<PP: PathParamsVariant> FromRequestParts<AppState> for UserFromPath<PP> {
    type Rejection = AppError;

    fn from_request_parts<'life0, 'life1, 'async_trait>(
        parts: &'life0 mut axum::http::request::Parts,
        state: &'life1 AppState,
    ) -> ::core::pin::Pin<
        Box<
            dyn ::core::future::Future<Output = Result<Self, Self::Rejection>>
                + ::core::marker::Send
                + 'async_trait,
        >,
    >
    where
        'life0: 'async_trait,
        'life1: 'async_trait,
        Self: 'async_trait,
    {
        Box::pin(async move {
            let Path(params) = Path::<HashMap<String, String>>::from_request_parts(parts, state)
                .await
                .map_err(|_| AppError::BadRequest("missing path param".to_string()))?;
            let username = params.get(PP::to_static_str()).ok_or_else(|| {
                AppError::BadRequest(format!("missing `{}` parameter", PP::to_static_str()))
            })?;
            let user = state.authentik_state.user_by_username(username).await?;
            Ok(UserFromPath {
                user,
                _p: std::marker::PhantomData,
            })
        })
    }
}

// ---------------------------------------------------------------------------
// Access Control structure
// ---------------------------------------------------------------------------

pub trait RoleCheck: Send + Sync + 'static {
    fn check(role: &GroupRole) -> Result<(), AppError>;
}

pub struct Leader;
pub struct ManagerOrLeader;

impl RoleCheck for Leader {
    fn check(role: &GroupRole) -> Result<(), AppError> {
        match role {
            GroupRole::Leader => Ok(()),
            _ => Err(AppError::Forbidden(
                "must be leader of this group".to_string(),
            )),
        }
    }
}
impl RoleCheck for ManagerOrLeader {
    fn check(role: &GroupRole) -> Result<(), AppError> {
        match role {
            GroupRole::Member => Err(AppError::Forbidden(
                "must be manager or leader of this group".to_string(),
            )),
            _ => Ok(()),
        }
    }
}

pub struct GroupAccess<R: RoleCheck> {
    pub group: Group,
    pub caller: User,
    pub role: GroupRole,
    _r: std::marker::PhantomData<R>,
}

/// Returns true when the caller is an authentik superuser AND sent `x-as-superuser: true`.
fn is_superuser_mode(caller: &User, parts: &axum::http::request::Parts) -> bool {
    caller.is_superuser
        && parts
            .headers
            .get("x-as-superuser")
            .and_then(|v| v.to_str().ok())
            == Some("true")
}

// One impl covers both cases
impl<R: RoleCheck> FromRequestParts<AppState> for GroupAccess<R> {
    type Rejection = AppError;
    fn from_request_parts<'life0, 'life1, 'async_trait>(
        parts: &'life0 mut axum::http::request::Parts,
        state: &'life1 AppState,
    ) -> ::core::pin::Pin<
        Box<
            dyn ::core::future::Future<Output = Result<Self, Self::Rejection>>
                + ::core::marker::Send
                + 'async_trait,
        >,
    >
    where
        'life0: 'async_trait,
        'life1: 'async_trait,
        Self: 'async_trait,
    {
        Box::pin(async move {
            let caller = User::from_request_parts(parts, state).await?;
            let GroupFromPath { group, .. } =
                GroupFromPath::<PathParamsGroupName>::from_request_parts(parts, state).await?;
            if is_superuser_mode(&caller, parts) {
                return Ok(GroupAccess {
                    group,
                    caller,
                    role: GroupRole::Leader,
                    _r: std::marker::PhantomData,
                });
            }
            if let Some(role) = state.authentik_state.user_group_role_relation(&group.name, &caller.username).await? {
                R::check(&role)?;
                Ok(GroupAccess {
                    group,
                    caller,
                    role,
                    _r: std::marker::PhantomData,
                })
            } else {
                Err(AppError::Forbidden(format!("Not a group member")))
            }
        })
    }
}

/// Grants access only when the caller is an authentik superuser and has sent `x-as-superuser: true`.
/// Use this extractor on handlers that should be superuser-only regardless of group membership.
pub struct SuperuserAccess {
    pub caller: User,
}

impl FromRequestParts<AppState> for SuperuserAccess {
    type Rejection = AppError;

    fn from_request_parts<'life0, 'life1, 'async_trait>(
        parts: &'life0 mut axum::http::request::Parts,
        state: &'life1 AppState,
    ) -> Pin<Box<dyn Future<Output = Result<Self, Self::Rejection>> + Send + 'async_trait>>
    where
        'life0: 'async_trait,
        'life1: 'async_trait,
        Self: 'async_trait,
    {
        Box::pin(async move {
            let caller = User::from_request_parts(parts, state).await?;
            if !is_superuser_mode(&caller, parts) {
                return Err(AppError::Forbidden("superuser mode required".to_string()));
            }
            Ok(SuperuserAccess { caller })
        })
    }
}

#[async_trait]
impl FromRequestParts<AppState> for User {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        _state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        // Middleware already validated and inserted the user — reuse it.
        return match parts.extensions.get::<User>() {
            Some(user) => Ok(user.clone()),
            None => Err(AppError::Unauthorized),
        };
    }
}


/// Blocks until the cache is fresh. Declare this first in any handler that reads from the cache.
pub struct FreshCache;

impl FromRequestParts<AppState> for FreshCache {
    type Rejection = Infallible;

    fn from_request_parts<'life0, 'life1, 'async_trait>(
        _parts: &'life0 mut Parts,
        state: &'life1 AppState,
    ) -> Pin<Box<dyn Future<Output = Result<Self, Self::Rejection>> + Send + 'async_trait>>
    where
        'life0: 'async_trait,
        'life1: 'async_trait,
        Self: 'async_trait,
    {
        Box::pin(async move {
            state.authentik_state.ensure_fresh().await;
            Ok(FreshCache)
        })
    }
}

/// Inserted into request extensions by `invalidate_on_write` middleware before the handler runs.
/// `WriteLock` flips it to signal that a write lock was acquired.
#[derive(Clone)]
pub struct WriteFlag(pub Arc<AtomicBool>);

/// Serialises concurrent writes and ensures reads see a consistent cache.
///
/// On extraction: marks the cache dirty immediately so reads block for the entire
/// write — not just after the response is on the wire.
/// The `invalidate_on_write` middleware then decides what to do with the dirty flag
/// based on the response status.
pub struct WriteLock {
    _guard: OwnedMutexGuard<()>,
}

impl FromRequestParts<AppState> for WriteLock {
    type Rejection = AppError;

    fn from_request_parts<'life0, 'life1, 'async_trait>(parts: &'life0 mut Parts, state: &'life1 AppState) -> Pin<Box<dyn Future<Output=Result<Self, Self::Rejection>> + Send + 'async_trait>>
    where
        'life0: 'async_trait,
        'life1: 'async_trait,
        Self: 'async_trait
    {
        Box::pin(async move {
            state.authentik_state.mark_dirty();
            if let Some(WriteFlag(flag)) = parts.extensions.get::<WriteFlag>() {
                flag.store(true, Ordering::Release);
            }
            Ok(WriteLock {
                _guard: Arc::clone(&state.write_mutex).lock_owned().await,
            })
        })
    }
}