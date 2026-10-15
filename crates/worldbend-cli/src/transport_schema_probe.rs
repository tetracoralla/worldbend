use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    env,
    io::{self, BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, ExitCode, Stdio},
    sync::mpsc::{self, Receiver},
    thread,
    time::Duration,
};

const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ProbeRequest {
    id: String,
    capability_id: String,
    capability_version: String,
}

fn main() -> ExitCode {
    let arguments = env::args_os().skip(1).collect::<Vec<_>>();
    if arguments.len() == 1 && arguments[0] == "--version" {
        println!(
            "worldbend-transport-schema-probe {}",
            env!("CARGO_PKG_VERSION")
        );
        return ExitCode::SUCCESS;
    }
    if !arguments.is_empty() {
        return fail("transport schema probe accepts no arguments");
    }
    match run() {
        Ok(response) => {
            println!("{response}");
            ExitCode::SUCCESS
        }
        Err(error) => fail(&error),
    }
}

fn run() -> Result<Value, String> {
    let request = read_request()?;
    if request.id != "transport-schema"
        || request.capability_id != "org.openadam.projective.transform"
        || request.capability_version != "0.2.0"
    {
        return Err("transport schema capability identity is unsupported".to_owned());
    }

    let executable = mcp_executable()?;
    let root = env::var_os("OPENADAM_PROVIDER_ROOT")
        .map(PathBuf::from)
        .unwrap_or(env::current_dir().map_err(|_| "provider root is unavailable")?);
    let mut child = Command::new(executable)
        .args(["--root".as_ref(), root.as_os_str()])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Worldbend MCP binary is unavailable".to_owned())?;
    let mut input = child
        .stdin
        .take()
        .ok_or_else(|| "Worldbend MCP input is unavailable".to_owned())?;
    let output = child
        .stdout
        .take()
        .ok_or_else(|| "Worldbend MCP output is unavailable".to_owned())?;
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(output).lines() {
            let parsed = line
                .map_err(|_| "Worldbend MCP output could not be read".to_owned())
                .and_then(|line| {
                    serde_json::from_str::<Value>(&line)
                        .map_err(|_| "Worldbend MCP returned invalid JSON".to_owned())
                });
            if sender.send(parsed).is_err() {
                break;
            }
        }
    });

    let result = probe(&mut input, &receiver).inspect_err(|_| stop(&mut child))?;
    stop(&mut child);
    Ok(json!({
        "id": request.id,
        "ok": true,
        "bindings": result,
    }))
}

fn probe(
    input: &mut ChildStdin,
    receiver: &Receiver<Result<Value, String>>,
) -> Result<Value, String> {
    request(
        input,
        receiver,
        1,
        "initialize",
        json!({
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": { "name": "worldbend-transport-schema-probe", "version": "1" }
        }),
    )?;
    write_message(
        input,
        &json!({ "jsonrpc": "2.0", "method": "notifications/initialized", "params": {} }),
    )?;
    let response = request(input, receiver, 2, "tools/list", json!({}))?;
    let tools = response
        .pointer("/result/tools")
        .and_then(Value::as_array)
        .ok_or_else(|| "Worldbend MCP tools/list response is incomplete".to_owned())?;
    let mut bindings = Vec::new();
    for operation_id in ["inspect", "render"] {
        let target = format!("worldbend.{operation_id}");
        let tool = tools
            .iter()
            .find(|tool| tool.get("name").and_then(Value::as_str) == Some(&target))
            .ok_or_else(|| format!("Worldbend MCP does not expose {target}"))?;
        let input_schema = tool
            .get("inputSchema")
            .cloned()
            .ok_or_else(|| format!("Worldbend MCP {target} has no input schema"))?;
        bindings.push(json!({
            "operationId": operation_id,
            "transport": "mcp-tool",
            "target": target,
            "inputSchema": input_schema,
        }));
    }
    Ok(Value::Array(bindings))
}

fn request(
    input: &mut ChildStdin,
    receiver: &Receiver<Result<Value, String>>,
    id: u64,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    write_message(
        input,
        &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }),
    )?;
    loop {
        let message = receiver
            .recv_timeout(TIMEOUT)
            .map_err(|_| format!("{method} timed out"))??;
        if message.get("id").and_then(Value::as_u64) != Some(id) {
            continue;
        }
        if message.get("error").is_some() {
            return Err(format!("{method} failed"));
        }
        return Ok(message);
    }
}

fn write_message(input: &mut ChildStdin, message: &Value) -> Result<(), String> {
    serde_json::to_writer(&mut *input, message)
        .map_err(|_| "Worldbend MCP request could not be encoded".to_owned())?;
    input
        .write_all(b"\n")
        .and_then(|_| input.flush())
        .map_err(|_| "Worldbend MCP request could not be sent".to_owned())
}

fn read_request() -> Result<ProbeRequest, String> {
    let mut bytes = Vec::new();
    io::stdin()
        .take((MAX_REQUEST_BYTES + 2) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "transport schema request is unavailable".to_owned())?;
    if bytes.is_empty() || bytes.len() > MAX_REQUEST_BYTES + 1 || !bytes.ends_with(b"\n") {
        return Err("transport schema request is unavailable or too large".to_owned());
    }
    bytes.pop();
    serde_json::from_slice(&bytes).map_err(|_| "transport schema request is invalid".to_owned())
}

fn mcp_executable() -> Result<PathBuf, String> {
    if let Some(configured) = env::var_os("OPENADAM_WORLDBEND_MCP") {
        let path = PathBuf::from(configured);
        return path
            .is_file()
            .then_some(path)
            .ok_or_else(|| "Configured Worldbend MCP binary is unavailable".to_owned());
    }
    let current = env::current_exe().map_err(|_| "probe executable path is unavailable")?;
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    let sibling = current
        .parent()
        .ok_or_else(|| "probe executable directory is unavailable".to_owned())?
        .join(format!("worldbend-mcp{suffix}"));
    sibling
        .is_file()
        .then_some(sibling)
        .ok_or_else(|| "Worldbend MCP binary must be installed beside the probe".to_owned())
}

fn stop(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn fail(message: &str) -> ExitCode {
    eprintln!("{}", message.chars().take(4096).collect::<String>());
    ExitCode::from(2)
}
