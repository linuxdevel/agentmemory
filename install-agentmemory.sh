#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${INSTALL_DIR:-/opt/agentmemory}"
SERVICE_NAME="${SERVICE_NAME:-agentmemory}"
NODE_DIR="/home/abols/.nvm/versions/node/v22.22.2"
NODE_BIN="${NODE_DIR}/bin/node"
NPM_BIN="${NODE_DIR}/bin/npm"
PLUGIN_SOURCE="${SOURCE_DIR}/integrations/opencode/plugin.js"
CLAUDE_HOOKS_SOURCE="${SOURCE_DIR}/integrations/claude-code/hooks"
CLAUDE_PLUGIN_SOURCE="${SOURCE_DIR}/plugin"
MCP_COMMAND_NODE="/home/abols/.nvm/versions/node/v22.22.2/bin/node"

if [[ ${EUID} -eq 0 ]]; then
  SERVICE_USER="${SERVICE_USER:-${SUDO_USER:-abols}}"
else
  SERVICE_USER="${SERVICE_USER:-$(id -un)}"
fi

SERVICE_HOME="${SERVICE_HOME:-$(getent passwd "${SERVICE_USER}" | cut -d: -f6 || true)}"
if [[ -z "${SERVICE_HOME}" ]]; then
  SERVICE_HOME="${HOME}"
fi

OPENCODE_HOME="${OPENCODE_HOME:-${SERVICE_HOME}}"
OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-${OPENCODE_HOME}/.config/opencode}"
OPENCODE_PLUGIN_PATH="${OPENCODE_PLUGIN_PATH:-${OPENCODE_CONFIG_DIR}/plugins/agentmemory.js}"
OPENCODE_CONFIG_PATH="${OPENCODE_CONFIG_PATH:-${OPENCODE_CONFIG_DIR}/opencode.json}"
AGENTMEMORY_DATA="${AGENTMEMORY_DATA:-${SERVICE_HOME}/.agentmemory}"
CLAUDE_HOME="${CLAUDE_HOME:-${SERVICE_HOME}}"
CLAUDE_SETTINGS_PATH="${CLAUDE_SETTINGS_PATH:-${CLAUDE_HOME}/.claude/settings.json}"
CLAUDE_HOOKS_DIR="${CLAUDE_HOOKS_DIR:-${CLAUDE_HOME}/.claude/hooks}"
CLAUDE_PLUGINS_DIR="${CLAUDE_PLUGINS_DIR:-${CLAUDE_HOME}/.claude/plugins}"
CLAUDE_PLUGIN_ID="agentmemory@agentmemory-local"
SYSTEMD_UNIT_PATH="${SYSTEMD_UNIT_PATH:-/etc/systemd/system/${SERVICE_NAME}.service}"
PLUGIN_URL="${PLUGIN_URL:-file://${OPENCODE_PLUGIN_PATH}}"
MCP_COMMAND_CLI="${MCP_COMMAND_CLI:-${INSTALL_DIR}/dist/cli.mjs}"
BUILD_USER="${BUILD_USER:-$(stat -c '%U' "${SOURCE_DIR}")}"
BUILD_HOME="${BUILD_HOME:-$(getent passwd "${BUILD_USER}" | cut -d: -f6 || true)}"

if [[ -z "${BUILD_HOME}" ]]; then
  BUILD_HOME="${SERVICE_HOME}"
fi

usage() {
  cat <<EOF
Usage: $(basename "$0")

Build agentmemory from the current checkout, deploy runtime files into ${INSTALL_DIR},
install the OpenCode plugin, Claude Code hooks, and merge configs.

Root mode:
  - deploys files into ${INSTALL_DIR}
  - creates/updates ${SYSTEMD_UNIT_PATH}
  - enables and restarts ${SERVICE_NAME}

Non-root mode:
  - deploys files into ${INSTALL_DIR} only when it is writable
  - installs the OpenCode plugin/config merge
  - skips systemd changes

Optional overrides:
  INSTALL_DIR, SERVICE_USER, SERVICE_HOME, OPENCODE_CONFIG_DIR,
  OPENCODE_PLUGIN_PATH, OPENCODE_CONFIG_PATH, AGENTMEMORY_DATA,
  SYSTEMD_UNIT_PATH, BUILD_USER, BUILD_HOME, CLAUDE_HOME,
  CLAUDE_SETTINGS_PATH, CLAUDE_HOOKS_DIR
EOF
}

info() {
  printf '[INFO] %s\n' "$*"
}

warn() {
  printf '[WARN] %s\n' "$*"
}

error() {
  printf '[ERROR] %s\n' "$*" >&2
  exit 1
}

run_as_build_user() {
  if [[ ${EUID} -eq 0 && "${BUILD_USER}" != "root" ]]; then
    sudo -u "${BUILD_USER}" env HOME="${BUILD_HOME}" PATH="${NODE_DIR}/bin:${PATH}" "$@"
  else
    env HOME="${BUILD_HOME}" PATH="${NODE_DIR}/bin:${PATH}" "$@"
  fi
}

ensure_writable_install_dir() {
  local parent_dir

  if [[ -d "${INSTALL_DIR}" ]]; then
    [[ -w "${INSTALL_DIR}" ]] || error "${INSTALL_DIR} is not writable"
    return
  fi

  parent_dir="$(dirname "${INSTALL_DIR}")"
  [[ -d "${parent_dir}" ]] || error "Parent directory ${parent_dir} does not exist"
  [[ -w "${parent_dir}" ]] || error "Parent directory ${parent_dir} is not writable"
}

sync_runtime() {
  local item

  command -v rsync >/dev/null 2>&1 || error "rsync is required"
  install -d -m 0755 "${INSTALL_DIR}"

  for item in dist node_modules; do
    [[ -d "${SOURCE_DIR}/${item}" ]] || error "Missing ${SOURCE_DIR}/${item}; build did not complete"
    rsync -a --delete "${SOURCE_DIR}/${item}/" "${INSTALL_DIR}/${item}/"
  done

  for item in package.json package-lock.json iii-config.yaml iii-config.docker.yaml docker-compose.yml; do
    [[ -f "${SOURCE_DIR}/${item}" ]] || error "Missing ${SOURCE_DIR}/${item}"
    rsync -a "${SOURCE_DIR}/${item}" "${INSTALL_DIR}/${item}"
  done

  if [[ ${EUID} -eq 0 ]]; then
    chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"
  fi
}

install_opencode_plugin() {
  local plugin_dir

  [[ -f "${PLUGIN_SOURCE}" ]] || error "Missing ${PLUGIN_SOURCE}"
  plugin_dir="$(dirname "${OPENCODE_PLUGIN_PATH}")"
  install -d -m 0755 "${plugin_dir}"
  if [[ ${EUID} -eq 0 ]]; then
    [[ -d "${plugin_dir}" ]] && chown -R "${SERVICE_USER}:${SERVICE_USER}" "${plugin_dir}"
  fi
  install -m 0644 "${PLUGIN_SOURCE}" "${OPENCODE_PLUGIN_PATH}"
  if [[ ${EUID} -eq 0 ]]; then
    chown "${SERVICE_USER}:${SERVICE_USER}" "${OPENCODE_PLUGIN_PATH}"
  fi
}

merge_opencode_config() {
  local config_dir

  config_dir="$(dirname "${OPENCODE_CONFIG_PATH}")"
  install -d -m 0755 "${config_dir}"
  if [[ ${EUID} -eq 0 ]]; then
    [[ -d "${config_dir}" ]] && chown -R "${SERVICE_USER}:${SERVICE_USER}" "${config_dir}"
  fi

  OPENCODE_CONFIG_PATH="${OPENCODE_CONFIG_PATH}" \
  PLUGIN_URL="${PLUGIN_URL}" \
  MCP_COMMAND_NODE="${MCP_COMMAND_NODE}" \
  MCP_COMMAND_CLI="${MCP_COMMAND_CLI}" \
  "${NODE_BIN}" <<'EOF'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const configPath = process.env.OPENCODE_CONFIG_PATH;
const pluginUrl = process.env.PLUGIN_URL;
const mcpCommandNode = process.env.MCP_COMMAND_NODE;
const mcpCommandCli = process.env.MCP_COMMAND_CLI;

if (!configPath || !pluginUrl || !mcpCommandNode || !mcpCommandCli) {
  throw new Error("Missing OpenCode config merge inputs");
}

let config = {};
if (existsSync(configPath)) {
  const raw = readFileSync(configPath, "utf8").trim();
  if (raw.length > 0) {
    config = JSON.parse(raw);
  }
}

if (!config || Array.isArray(config) || typeof config !== "object") {
  throw new Error(`${configPath} must contain a JSON object`);
}

const next = { ...config };
const plugin = Array.isArray(next.plugin) ? [...next.plugin] : [];
if (!plugin.includes(pluginUrl)) {
  plugin.push(pluginUrl);
}
next.plugin = plugin;

const mcp = next.mcp && typeof next.mcp === "object" && !Array.isArray(next.mcp)
  ? { ...next.mcp }
  : {};
const agentmemory = mcp.agentmemory && typeof mcp.agentmemory === "object" && !Array.isArray(mcp.agentmemory)
  ? { ...mcp.agentmemory }
  : {};

agentmemory.type = "local";
agentmemory.command = [mcpCommandNode, mcpCommandCli, "mcp"];

mcp.agentmemory = agentmemory;
next.mcp = mcp;

mkdirSync(dirname(configPath), { recursive: true });
writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`);
EOF

  if [[ ${EUID} -eq 0 ]]; then
    chown "${SERVICE_USER}:${SERVICE_USER}" "${OPENCODE_CONFIG_PATH}"
  fi
}

install_claude_hooks() {
  local hook_file

  [[ -d "${CLAUDE_HOOKS_SOURCE}" ]] || error "Missing ${CLAUDE_HOOKS_SOURCE}"
  install -d -m 0755 "${CLAUDE_HOOKS_DIR}"
  if [[ ${EUID} -eq 0 ]]; then
    [[ -d "${CLAUDE_HOOKS_DIR}" ]] && chown -R "${SERVICE_USER}:${SERVICE_USER}" "${CLAUDE_HOOKS_DIR}"
  fi

  for hook_file in "${CLAUDE_HOOKS_SOURCE}"/agentmemory-*.sh; do
    [[ -f "${hook_file}" ]] || continue
    install -m 0755 "${hook_file}" "${CLAUDE_HOOKS_DIR}/$(basename "${hook_file}")"
    if [[ ${EUID} -eq 0 ]]; then
      chown "${SERVICE_USER}:${SERVICE_USER}" "${CLAUDE_HOOKS_DIR}/$(basename "${hook_file}")"
    fi
  done
}

install_claude_plugin() {
  local plugin_json version install_path

  [[ -d "${CLAUDE_PLUGIN_SOURCE}" ]] || error "Missing ${CLAUDE_PLUGIN_SOURCE}"
  [[ -f "${CLAUDE_PLUGIN_SOURCE}/.claude-plugin/plugin.json" ]] || error "Missing plugin.json"

  version=$("${NODE_BIN}" -e "process.stdout.write(JSON.parse(require('fs').readFileSync('${CLAUDE_PLUGIN_SOURCE}/.claude-plugin/plugin.json','utf8')).version||'local')")
  install_path="${CLAUDE_PLUGINS_DIR}/cache/agentmemory-local/agentmemory/${version}"

  install -d -m 0755 "${install_path}"
  rsync -a --delete "${CLAUDE_PLUGIN_SOURCE}/" "${install_path}/"

  if [[ ${EUID} -eq 0 ]]; then
    chown -R "${SERVICE_USER}:${SERVICE_USER}" "${install_path}"
  fi

  # Register in installed_plugins.json
  INSTALLED_PLUGINS_PATH="${CLAUDE_PLUGINS_DIR}/installed_plugins.json" \
  INSTALL_PATH="${install_path}" \
  PLUGIN_VERSION="${version}" \
  PLUGIN_ID="${CLAUDE_PLUGIN_ID}" \
  "${NODE_BIN}" <<'REGEOF'
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const filePath = process.env.INSTALLED_PLUGINS_PATH;
const installPath = process.env.INSTALL_PATH;
const version = process.env.PLUGIN_VERSION;
const pluginId = process.env.PLUGIN_ID;

let data = { version: 2, plugins: {} };
if (existsSync(filePath)) {
  const raw = readFileSync(filePath, "utf8").trim();
  if (raw.length > 0) data = JSON.parse(raw);
}

const entry = {
  scope: "user",
  installPath,
  version,
  installedAt: new Date().toISOString(),
  lastUpdated: new Date().toISOString(),
};

data.plugins[pluginId] = [entry];
writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
REGEOF

  if [[ ${EUID} -eq 0 ]]; then
    chown "${SERVICE_USER}:${SERVICE_USER}" "${CLAUDE_PLUGINS_DIR}/installed_plugins.json"
  fi
}

merge_claude_settings() {
  local settings_dir

  settings_dir="$(dirname "${CLAUDE_SETTINGS_PATH}")"
  install -d -m 0755 "${settings_dir}"
  if [[ ${EUID} -eq 0 ]]; then
    [[ -d "${settings_dir}" ]] && chown -R "${SERVICE_USER}:${SERVICE_USER}" "${settings_dir}"
  fi

  CLAUDE_SETTINGS_PATH="${CLAUDE_SETTINGS_PATH}" \
  CLAUDE_HOOKS_DIR="${CLAUDE_HOOKS_DIR}" \
  MCP_COMMAND_NODE="${MCP_COMMAND_NODE}" \
  MCP_COMMAND_CLI="${MCP_COMMAND_CLI}" \
  CLAUDE_PLUGIN_ID="${CLAUDE_PLUGIN_ID}" \
  "${NODE_BIN}" <<'EOF'
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const settingsPath = process.env.CLAUDE_SETTINGS_PATH;
const hooksDir = process.env.CLAUDE_HOOKS_DIR;
const mcpNode = process.env.MCP_COMMAND_NODE;
const mcpCli = process.env.MCP_COMMAND_CLI;
const pluginId = process.env.CLAUDE_PLUGIN_ID;

if (!settingsPath || !hooksDir || !mcpNode || !mcpCli || !pluginId) {
  throw new Error("Missing Claude Code settings merge inputs");
}

let settings = {};
if (existsSync(settingsPath)) {
  const raw = readFileSync(settingsPath, "utf8").trim();
  if (raw.length > 0) settings = JSON.parse(raw);
}

if (!settings || Array.isArray(settings) || typeof settings !== "object") {
  throw new Error(`${settingsPath} must contain a JSON object`);
}

// --- MCP server ---
const mcpServers = settings.mcpServers && typeof settings.mcpServers === "object"
  ? { ...settings.mcpServers }
  : {};
mcpServers.agentmemory = {
  command: mcpNode,
  args: [mcpCli, "mcp"],
};
settings.mcpServers = mcpServers;

// --- Hooks ---
const hooks = settings.hooks && typeof settings.hooks === "object"
  ? { ...settings.hooks }
  : {};

function ensureHookEntry(eventName, matcher, hookCommand, timeout) {
  const entries = Array.isArray(hooks[eventName]) ? [...hooks[eventName]] : [];
  const alreadyPresent = entries.some((entry) =>
    Array.isArray(entry.hooks) &&
    entry.hooks.some((h) => h.command === hookCommand)
  );
  if (!alreadyPresent) {
    const hookDef = { type: "command", command: hookCommand };
    if (timeout) hookDef.timeout = timeout;
    entries.push({ matcher, hooks: [hookDef] });
  }
  hooks[eventName] = entries;
}

ensureHookEntry("UserPromptSubmit", "", `${hooksDir}/agentmemory-prompt.sh`, 10);
ensureHookEntry("PreToolUse", "Read|Write|Edit|Grep|Glob", `${hooksDir}/agentmemory-pretool.sh`, 5);
ensureHookEntry("PostToolUse", "", `${hooksDir}/agentmemory-posttool.sh`, 5);

settings.hooks = hooks;

// --- Enable plugin ---
const enabledPlugins = settings.enabledPlugins && typeof settings.enabledPlugins === "object"
  ? { ...settings.enabledPlugins }
  : {};
enabledPlugins[pluginId] = true;
settings.enabledPlugins = enabledPlugins;

writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
EOF

  if [[ ${EUID} -eq 0 ]]; then
    chown "${SERVICE_USER}:${SERVICE_USER}" "${CLAUDE_SETTINGS_PATH}"
  fi
}

install_env_file() {
  local env_file old_umask

  env_file="${AGENTMEMORY_DATA}/.env"
  install -d -m 0700 "${AGENTMEMORY_DATA}"
  if [[ ${EUID} -eq 0 ]]; then
    chown "${SERVICE_USER}:${SERVICE_USER}" "${AGENTMEMORY_DATA}"
  fi
  if [[ -f "${env_file}" ]]; then
    chmod 0600 "${env_file}"
    return
  fi

  old_umask="$(umask)"
  umask 077
  cat >"${env_file}" <<'EOF'
# agentmemory configuration
# Uncomment and set as needed

# ANTHROPIC_API_KEY=sk-ant-...
# GEMINI_API_KEY=...
# OPENROUTER_API_KEY=...

EMBEDDING_PROVIDER=local
AGENTMEMORY_TOOLS=all
# III_REST_PORT=3111
EOF
  umask "${old_umask}"

  if [[ ${EUID} -eq 0 ]]; then
    chown "${SERVICE_USER}:${SERVICE_USER}" "${env_file}"
  fi
  chmod 0600 "${env_file}"
}

install_systemd_unit() {
  cat >"${SYSTEMD_UNIT_PATH}" <<EOF
[Unit]
Description=AgentMemory - Persistent memory for AI coding agents
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${NODE_BIN} --max-old-space-size=256 ${INSTALL_DIR}/dist/cli.mjs
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
EnvironmentFile=-${AGENTMEMORY_DATA}/.env
Environment=NODE_ENV=production
Environment=HOME=${SERVICE_HOME}
Environment=PATH=${NODE_DIR}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${AGENTMEMORY_DATA} ${INSTALL_DIR}
ProtectHome=false

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}.service" >/dev/null
  if systemctl is-active --quiet "${SERVICE_NAME}.service"; then
    systemctl restart "${SERVICE_NAME}.service"
  else
    systemctl start "${SERVICE_NAME}.service"
  fi
}

main() {
  if [[ ${1:-} == "--help" || ${1:-} == "-h" ]]; then
    usage
    exit 0
  fi

  [[ -x "${NODE_BIN}" ]] || error "Expected Node.js at ${NODE_BIN}"
  [[ -x "${NPM_BIN}" ]] || error "Expected npm at ${NPM_BIN}"
  [[ -f "${PLUGIN_SOURCE}" ]] || error "Missing ${PLUGIN_SOURCE}"

  if [[ ${EUID} -ne 0 ]]; then
    ensure_writable_install_dir
  fi

  info "Using Node $("${NODE_BIN}" -v)"
  info "Installing dependencies from current checkout"
  run_as_build_user "${NPM_BIN}" --prefix "${SOURCE_DIR}" ci

  info "Building current checkout"
  run_as_build_user "${NPM_BIN}" --prefix "${SOURCE_DIR}" run build

  info "Syncing runtime files into ${INSTALL_DIR}"
  sync_runtime

  info "Installing OpenCode plugin to ${OPENCODE_PLUGIN_PATH}"
  install_opencode_plugin

  info "Merging OpenCode config at ${OPENCODE_CONFIG_PATH}"
  merge_opencode_config

  info "Installing Claude Code hooks to ${CLAUDE_HOOKS_DIR}"
  install_claude_hooks

  info "Installing Claude Code plugin (skills: remember, recall, forget, session-history)"
  install_claude_plugin

  info "Merging Claude Code settings at ${CLAUDE_SETTINGS_PATH}"
  merge_claude_settings

  if [[ ${EUID} -eq 0 ]]; then
    info "Installing systemd service ${SERVICE_NAME}"
    install_env_file
    install_systemd_unit
  else
    info "Skipping systemd changes in non-root mode"
  fi

  info "Deployment finished"
}

main "$@"
