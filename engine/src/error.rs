use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

#[derive(Debug, Clone)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
    pub retry_after: Option<u64>,
    /// `transcode_limit`: why the stream needs a slot, in the decision's own words.
    pub need: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorBody {
    pub code: &'static str,
    pub message: String,
}

impl From<ApiError> for ErrorBody {
    fn from(e: ApiError) -> Self {
        Self {
            code: e.code,
            message: e.message,
        }
    }
}

#[derive(Serialize)]
struct Envelope<'a> {
    message: &'a str,
    code: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_after: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    need: Option<&'a str>,
}

impl ApiError {
    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
            retry_after: None,
            need: None,
        }
    }

    pub fn invalid_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "invalid_request", message)
    }

    pub fn session_exists() -> Self {
        Self::new(
            StatusCode::CONFLICT,
            "session_exists",
            "session already exists",
        )
    }

    pub fn job_exists() -> Self {
        Self::new(StatusCode::CONFLICT, "job_exists", "job already exists")
    }

    pub fn file_not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, "file_not_found", message)
    }

    pub fn no_video_stream() -> Self {
        Self::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "no_video_stream",
            "file has no video stream",
        )
    }

    pub fn unreadable_file(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNPROCESSABLE_ENTITY, "unreadable_file", message)
    }

    pub fn method_not_allowed() -> Self {
        Self::new(
            StatusCode::METHOD_NOT_ALLOWED,
            "method_not_allowed",
            "method not allowed on this route",
        )
    }

    pub fn transcode_limit(retry_after: u64, need: Option<String>) -> Self {
        Self {
            retry_after: Some(retry_after),
            need,
            ..Self::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "transcode_limit",
                "all transcode slots are in use",
            )
        }
    }

    pub fn transcode_unavailable(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "transcode_unavailable",
            message,
        )
    }

    pub fn ffmpeg_unavailable(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "ffmpeg_unavailable",
            message,
        )
    }

    pub fn queue_full(retry_after: u64) -> Self {
        Self {
            retry_after: Some(retry_after),
            ..Self::new(
                StatusCode::TOO_MANY_REQUESTS,
                "queue_full",
                "job queue is full",
            )
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, "not_found", message)
    }

    pub fn unauthorized() -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "missing or invalid credentials",
        )
    }

    pub fn forbidden() -> Self {
        Self::new(
            StatusCode::FORBIDDEN,
            "forbidden",
            "token is invalid or expired",
        )
    }

    pub fn read_only() -> Self {
        Self::new(StatusCode::CONFLICT, "read_only", "the config is read-only")
    }

    pub fn invalid_setting(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "invalid_setting", message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal", message)
    }

    pub fn ffmpeg_failed(message: impl Into<String>) -> Self {
        Self::new(StatusCode::SERVICE_UNAVAILABLE, "ffmpeg_failed", message)
    }

    pub fn session_restarted() -> Self {
        Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "session_restarted",
            "session was restarted while the request waited",
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = Envelope {
            message: &self.message,
            code: self.code,
            retry_after: self.retry_after,
            need: self.need.as_deref(),
        };
        (self.status, Json(body)).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn envelope_shape() {
        let res = ApiError::transcode_limit(10, Some("x".into())).into_response();
        assert_eq!(res.status(), StatusCode::SERVICE_UNAVAILABLE);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["code"], "transcode_limit");
        assert_eq!(v["retry_after"], 10);
        assert_eq!(v["need"], "x");
        assert!(v["message"].is_string());
    }

    #[test]
    fn retry_after_omitted_by_default() {
        let body = serde_json::to_value(Envelope {
            message: "m",
            code: "not_found",
            retry_after: None,
            need: None,
        })
        .unwrap();
        assert!(body.get("retry_after").is_none());
        assert!(body.get("need").is_none());
    }
}
