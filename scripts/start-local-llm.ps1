$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskRuntime = Join-Path $taskRoot '.local-llm/runtime/ollama.exe'
if (-not (Test-Path -LiteralPath $taskRuntime)) {
  throw 'Run node scripts/install-local-llm.mjs first, or install Ollama from https://ollama.com/download/windows.'
}
$env:OLLAMA_MODELS = Join-Path $taskRoot '.local-llm/models'
$env:OLLAMA_HOST = '127.0.0.1:11434'
$env:OLLAMA_NO_CLOUD = '1'
$env:OLLAMA_NUM_PARALLEL = '1'
New-Item -ItemType Directory -Force -Path $env:OLLAMA_MODELS | Out-Null
try {
  Invoke-RestMethod 'http://127.0.0.1:11434/api/version' -TimeoutSec 2 | Out-Null
  Write-Output 'Ollama is already running on localhost:11434.'
} catch {
  $taskProcess = Start-Process -FilePath $taskRuntime -ArgumentList 'serve' -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskRoot '.local-llm/ollama.stdout.log') -RedirectStandardError (Join-Path $taskRoot '.local-llm/ollama.stderr.log')
  Write-Output "Started local Ollama CPU server (PID $($taskProcess.Id))."
}
