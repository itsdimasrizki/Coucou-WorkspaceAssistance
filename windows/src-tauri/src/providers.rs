// Chat with providers other than Anthropic: Google Gemini, and anything that
// speaks the OpenAI chat-completions protocol (OpenAI itself, Ollama,
// LM Studio, OpenRouter, Groq...).
//
// Same rules as claude.rs: the API key stays on the Rust side, and the island
// only receives the reply text. Text and code files can be attached; PDFs and
// images are Claude-only for now.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};

use crate::claude::{ChatContext, ChatReply};
use crate::secrets;

pub const GEMINI_DEFAULT_MODEL: &str = "gemini-2.5-flash";
pub const OPENAI_DEFAULT_MODEL: &str = "gpt-4o-mini";
pub const OPENAI_DEFAULT_BASE: &str = "https://api.openai.com/v1";

const GEMINI_ENDPOINT: &str = "https://generativelanguage.googleapis.com/v1beta/models";
/// Text and code files are inlined; anything larger is skipped, as for Claude.
const MAX_INLINE_TEXT: u64 = 200_000;

const SYSTEM_PROMPT: &str = "You are Mochi, a personal AI assistant living at the top of the user's screen. \
You can help with absolutely anything — research, coding, recommendations, tasks, questions. \
Respond in the user's language. Be thorough and complete — use as much detail as the task requires. \
No markdown formatting (no **, no ##, no bullet dashes). Use plain text with line breaks.";

/// One history per provider, so switching provider never mixes formats.
/// Each turn is (role, text) with role "user" or "assistant".
#[derive(Default)]
pub struct PlainChat {
    turns: Mutex<HashMap<String, Vec<(String, String)>>>,
}

impl PlainChat {
    pub fn reset(&self) {
        self.turns.lock().unwrap().clear();
    }

    fn snapshot(&self, provider: &str) -> Vec<(String, String)> {
        self.turns.lock().unwrap().get(provider).cloned().unwrap_or_default()
    }

    fn push(&self, provider: &str, role: &str, text: String) {
        self.turns
            .lock()
            .unwrap()
            .entry(provider.to_string())
            .or_default()
            .push((role.to_string(), text));
    }

    fn pop(&self, provider: &str) {
        if let Some(v) = self.turns.lock().unwrap().get_mut(provider) {
            v.pop();
        }
    }
}

/// One chat turn against `provider` ("gemini" or "openai").
pub async fn send(
    chat: &PlainChat,
    provider: &str,
    model: &str,
    base_url: &str,
    query: String,
    context: Option<ChatContext>,
) -> Result<ChatReply, String> {
    let model = model.trim();
    if model.is_empty() {
        return Err("No model set. Open settings.".into());
    }

    let history = chat.snapshot(provider);

    // File / window context rides along with the first message only.
    let mut text = String::new();
    if history.is_empty() {
        if let Some(ctx) = &context {
            text.push_str(&context_text(ctx)?);
            text.push_str("\n\n");
        }
    }
    text.push_str(&query);

    chat.push(provider, "user", text);
    let turns = chat.snapshot(provider);

    let result = match provider {
        "gemini" => gemini(model, &turns).await,
        "openai" => openai(model, base_url, &turns).await,
        other => Err(format!("Unknown provider {other}.")),
    };

    match result {
        Ok(reply) => {
            chat.push(provider, "assistant", reply.clone());
            Ok(ChatReply { text: reply })
        }
        Err(err) => {
            chat.pop(provider); // keep the history consistent with what the model saw
            Err(err)
        }
    }
}

fn context_text(ctx: &ChatContext) -> Result<String, String> {
    match ctx {
        ChatContext::File { name, path } => {
            let ext = std::path::Path::new(path)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if matches!(ext.as_str(), "pdf" | "jpg" | "jpeg" | "png" | "gif" | "webp") {
                return Err("Only Claude can read PDFs and images. Drop a text or code file instead.".into());
            }
            let len = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
            if len > MAX_INLINE_TEXT {
                return Err("That file is too large to send.".into());
            }
            let body = std::fs::read_to_string(path)
                .map_err(|_| "I can only read text and code files with this provider.".to_string())?;
            Ok(format!("File: {name}\nFile contents:\n{body}"))
        }
        ChatContext::Window { app_name, title, url } => {
            let mut s = format!("Context — App: {app_name}, Window: {title}");
            if let Some(url) = url {
                s.push_str(&format!(", URL: {url}"));
            }
            Ok(s)
        }
    }
}

// ── Gemini ────────────────────────────────────────────────────────────────────

async fn gemini(model: &str, turns: &[(String, String)]) -> Result<String, String> {
    let key = secrets::get("gemini-api-key")
        .ok_or_else(|| "Gemini API key missing. Open settings.".to_string())?;

    // The model id goes into the URL path: keep it to plain identifier characters.
    if !model.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')) {
        return Err("Invalid Gemini model name.".into());
    }

    let contents: Vec<Value> = turns
        .iter()
        .map(|(role, text)| {
            json!({
                "role": if role == "user" { "user" } else { "model" },
                "parts": [{ "text": text }],
            })
        })
        .collect();

    let body = json!({
        "systemInstruction": { "parts": [{ "text": SYSTEM_PROMPT }] },
        "contents": contents,
    });

    let url = format!("{GEMINI_ENDPOINT}/{model}:generateContent");
    let response = post_json(&url, vec![("x-goog-api-key", key)], &body, "Gemini API").await?;

    let text = response
        .get("candidates")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("content"))
        .and_then(|c| c.get("parts"))
        .and_then(Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter_map(|p| p.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    let text = text.trim().to_string();

    if text.is_empty() {
        let blocked = response
            .get("promptFeedback")
            .and_then(|f| f.get("blockReason"))
            .and_then(Value::as_str);
        return Err(match blocked {
            Some(reason) => format!("Gemini declined this one ({reason})."),
            None => "No response text.".into(),
        });
    }
    Ok(text)
}

// ── OpenAI-compatible ─────────────────────────────────────────────────────────

async fn openai(model: &str, base_url: &str, turns: &[(String, String)]) -> Result<String, String> {
    let base = base_url.trim().trim_end_matches('/');
    let base = if base.is_empty() { OPENAI_DEFAULT_BASE } else { base };

    let loopback = ["http://localhost", "http://127.0.0.1", "http://[::1]"]
        .iter()
        .any(|p| base.starts_with(p));
    if !base.starts_with("https://") && !loopback {
        return Err("The server URL must be https://, or http:// on localhost.".into());
    }

    // Local servers (Ollama, LM Studio) need no key; the real OpenAI does.
    let key = secrets::get("openai-api-key");
    if key.is_none() && base == OPENAI_DEFAULT_BASE {
        return Err("OpenAI API key missing. Open settings.".into());
    }

    let mut messages = vec![json!({ "role": "system", "content": SYSTEM_PROMPT })];
    messages.extend(
        turns
            .iter()
            .map(|(role, text)| json!({ "role": role, "content": text })),
    );
    let body = json!({ "model": model, "messages": messages });

    let mut headers = Vec::new();
    if let Some(key) = key {
        headers.push(("authorization", format!("Bearer {key}")));
    }

    let url = format!("{base}/chat/completions");
    let response = post_json(&url, headers, &body, "Chat API").await?;

    let text = response
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();

    if text.is_empty() {
        return Err("No response text.".into());
    }
    Ok(text)
}

// ── Shared HTTP ───────────────────────────────────────────────────────────────

async fn post_json(
    url: &str,
    headers: Vec<(&str, String)>,
    body: &Value,
    label: &str,
) -> Result<Value, String> {
    // Local models can be slow to load their first answer.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;

    let mut request = client.post(url).header("content-type", "application/json");
    for (name, value) in headers {
        request = request.header(name, value);
    }

    let response = request
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        // Both Gemini and OpenAI put a readable message at error.message.
        let detail = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| text.chars().take(200).collect());
        return Err(format!("{label} {status}: {detail}"));
    }
    serde_json::from_str(&text).map_err(|e| format!("Bad API response: {e}"))
}
