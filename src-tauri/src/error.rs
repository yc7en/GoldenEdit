use serde::ser::{Serialize, SerializeStruct, Serializer};

/// 宿主返回给前端的结构化错误。
/// `code` 用于前端分支判断（CONFLICT / TOO_LARGE / DENIED / NOT_FOUND / IO / UNKNOWN），
/// `message` 面向用户，可直接展示。
#[derive(Debug, Clone)]
pub struct ApiError {
    pub code: &'static str,
    pub message: String,
}

pub type ApiResult<T> = Result<T, ApiError>;

impl ApiError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
    pub fn denied(message: impl Into<String>) -> Self {
        Self::new("DENIED", message)
    }
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("NOT_FOUND", message)
    }
    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new("CONFLICT", message)
    }
    pub fn too_large(message: impl Into<String>) -> Self {
        Self::new("TOO_LARGE", message)
    }
    pub fn io(err: impl std::fmt::Display) -> Self {
        Self::new("IO", err.to_string())
    }
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("INTERNAL", message)
    }
}

impl Serialize for ApiError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("ApiError", 2)?;
        s.serialize_field("code", self.code)?;
        s.serialize_field("message", &self.message)?;
        s.end()
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl From<std::io::Error> for ApiError {
    fn from(e: std::io::Error) -> Self {
        if e.kind() == std::io::ErrorKind::NotFound {
            ApiError::not_found(e.to_string())
        } else {
            ApiError::io(e)
        }
    }
}
