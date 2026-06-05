use proc_macro::TokenStream;
use quote::{format_ident, quote};
use syn::{
    braced,
    parse::{Parse, ParseStream, Result},
    parse_macro_input, Ident, LitStr, Token, Visibility,
};

struct LabeledVariant {
    ident: Ident,
    label: LitStr,
}

struct LabeledEnum {
    vis: Visibility,
    name: Ident,
    variants: Vec<LabeledVariant>,
}

impl Parse for LabeledEnum {
    fn parse(input: ParseStream) -> Result<Self> {
        let vis: Visibility = input.parse()?;
        input.parse::<Token![enum]>()?;
        let name: Ident = input.parse()?;

        let content;
        braced!(content in input);

        let mut variants = Vec::new();
        while !content.is_empty() {
            let ident: Ident = content.parse()?;
            content.parse::<Token![=>]>()?;
            let label: LitStr = content.parse()?;
            variants.push(LabeledVariant { ident, label });
            if content.peek(Token![,]) {
                content.parse::<Token![,]>()?;
            }
        }

        Ok(LabeledEnum {
            vis,
            name,
            variants,
        })
    }
}

/// Generates an enum, a `to_static_string` impl, a `<Name>Variant` trait, and a
/// zero-sized struct per variant that implements the trait.
///
/// ```rust
/// labeled_enum! {
///     pub enum Foo {
///         A => "a_string",
///         B => "another string",
///     }
/// }
/// ```
#[proc_macro]
pub fn labeled_enum(input: TokenStream) -> TokenStream {
    let LabeledEnum {
        vis,
        name,
        variants,
    } = parse_macro_input!(input as LabeledEnum);

    let variant_idents: Vec<&Ident> = variants.iter().map(|v| &v.ident).collect();
    let labels: Vec<&LitStr> = variants.iter().map(|v| &v.label).collect();
    let trait_name = format_ident!("{}Variant", name);
    let struct_names: Vec<Ident> = variants
        .iter()
        .map(|v| format_ident!("{}{}", name, v.ident))
        .collect();

    quote! {
        #vis enum #name {
            #(#variant_idents,)*
        }

        impl #name {
            pub const fn to_static_str(&self) -> &'static str {
                match self {
                    #(Self::#variant_idents => #labels,)*
                }
            }
        }

        pub trait #trait_name {
            fn to_enum() -> #name;
            fn to_static_str() -> &'static str {
                Self::to_enum().to_static_str()
            }
        }

        #(
            pub struct #struct_names;

            impl #trait_name for #struct_names {
                fn to_enum() -> #name {
                    #name::#variant_idents
                }
            }
        )*
    }
    .into()
}
