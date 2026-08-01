//! Terminal stream helpers shared by local and SSH PTYs.
//!
//! Parsers here observe the raw byte stream and never rewrite it.

mod osc133;
mod shell_integration;

pub use osc133::{BlockEvent, Osc133Parser};
pub use shell_integration::{
    BASH_INTEGRATION, ZSH_INTEGRATION, ssh_bash_wrapper_command, ssh_default_wrapper_command,
    ssh_zsh_wrapper_command,
};
