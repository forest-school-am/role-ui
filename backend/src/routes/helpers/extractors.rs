use std::collections::HashMap;

use autentik_macros::labeled_enum;
use axum::extract::{FromRequestParts, Path};

use crate::{
    auth::AuthenticatedUser,
    authentik::{resolve_role, AuthentikGroup, AuthentikUser},
    error::AppError,
    models::GroupRole,
    AppState,
};

labeled_enum! {
    pub enum PathParams {
        GroupName => "group_name",
        UserPK => "user_pk",
        ChildGroupName => "child_group_name",
        Username => "username",
    }
}

pub struct GroupFromPath<PP: PathParamsVariant> {
    pub group: AuthentikGroup,
    pub _p: std::marker::PhantomData<PP>,
}

pub struct UserFromPath<PP: PathParamsVariant> {
    pub user: AuthentikUser,
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
            let group = state.authentik.get_group_by_name(group_name).await?;
            Ok(GroupFromPath {
                group,
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
            let user = state.authentik.get_user_by_username(username).await?;
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
    pub group: AuthentikGroup,
    pub caller: AuthenticatedUser,
    pub role: GroupRole,
    _r: std::marker::PhantomData<R>,
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
            let caller = AuthenticatedUser::from_request_parts(parts, state).await?;
            let GroupFromPath { group, .. } =
                GroupFromPath::<PathParamsGroupName>::from_request_parts(parts, state).await?;
            let role = resolve_role(&group, &caller.uuid);
            R::check(&role)?;
            Ok(GroupAccess {
                group,
                caller,
                role,
                _r: std::marker::PhantomData,
            })
        })
    }
}
