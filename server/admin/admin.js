const $ = (id) => document.getElementById(id);
let csrf = "",
  configuration = null,
  initialized = false;
async function api(path, method = "GET", input) {
  const response = await fetch(`/admin/api/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-Worket-CSRF": csrf } : {}),
    },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "login") {
      await session();
    }
    throw new Error(result.message || result.code || "请求失败");
  }
  return result;
}
let noticeTimer;
function message(text, error = false) {
  $("message").textContent = text;
  $("message").className = error ? "error" : "";
  $("message").hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(
    () => ($("message").hidden = true),
    error ? 12000 : 5000,
  );
}
function bind(id, event, action) {
  $(id).addEventListener(event, async (e) => {
    e.preventDefault();
    const button =
      e.submitter ??
      (e.currentTarget.tagName === "BUTTON" ? e.currentTarget : null);
    if (button) button.disabled = true;
    try {
      await action();
    } catch (error) {
      message(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  });
}
function showTab(tab) {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
    button.setAttribute("aria-pressed", String(button.dataset.tab === tab));
  });
  for (const name of ["model", "clients", "activity"])
    $(`${name}-panel`).hidden = name !== tab;
}
async function session() {
  const state = await api("session");
  initialized = state.initialized;
  csrf = state.csrf ?? "";
  $("login-panel").hidden = state.authenticated;
  $("workspace").hidden = !state.authenticated;
  $("logout").hidden = !state.authenticated;
  $("login-title").textContent = initialized
    ? "登录 Worket 后台"
    : "设置你的后台";
  $("login-intro").textContent = initialized
    ? "使用管理员密码管理模型配置和接入凭据。"
    : "先设置管理员密码，之后只有你可以修改模型配置和生成接入凭据。";
  $("confirm-password-label").hidden = initialized;
  $("confirm-password").required = !initialized;
  $("admin-password").autocomplete = initialized
    ? "current-password"
    : "new-password";
  $("login-submit").textContent = initialized ? "登录" : "创建管理员并继续";
  $("service-state").textContent = state.authenticated
    ? "已登录"
    : initialized
      ? "等待登录"
      : "首次设置";
  if (state.authenticated) await load();
  else {
    configuration = null;
    $("provider-key").value = "";
    $("client-token").value = "";
    $("issued-client").hidden = true;
  }
}
function setValue(id, value) {
  $(id).value = value ?? "";
}
async function load() {
  configuration = await api("config");
  const p = configuration.provider;
  for (const [id, value] of [
    ["provider-url", p.baseUrl],
    ["provider-model", p.model],
    ["provider-name", p.name],
    ["provider-policy", p.policyUrl],
    ["provider-key", ""],
    ["public-url", configuration.serviceUrl],
    ["connection-url", configuration.serviceUrl || configuration.localUrl],
    ["limit-daily", configuration.limits.dailyCalls],
    ["limit-user", configuration.limits.maxConcurrency],
    ["limit-global", configuration.limits.maxGlobalConcurrency],
    ["limit-sources", configuration.limits.maxSources],
    ["limit-timeout", configuration.limits.timeoutMs / 1000],
  ])
    setValue(id, value);
  $("key-status").textContent = p.hasKey ? "已保存" : "未设置";
  $("provider-key").placeholder = p.hasKey
    ? "留空保留已保存的密钥"
    : "填写供应商 API Key";
  $("key-help").textContent = p.hasKey
    ? "已保存的密钥不会返回页面。更换 API 地址时，需要重新填写密钥。"
    : "密钥仅保存在后台，不会返回给桌面 App。";
  $("service-state").textContent = configuration.status.configured
    ? "模型已配置"
    : "等待填写模型";
  $("running-count").textContent = configuration.status.running;
  renderClients();
  await activity();
}
function input() {
  return {
    revision: configuration.revision,
    provider: {
      baseUrl: $("provider-url").value,
      model: $("provider-model").value,
      apiKey: $("provider-key").value,
      name: $("provider-name").value,
      policyUrl: $("provider-policy").value,
    },
    serviceUrl: $("public-url").value,
    limits: {
      dailyCalls: Number($("limit-daily").value),
      maxConcurrency: Number($("limit-user").value),
      maxGlobalConcurrency: Number($("limit-global").value),
      maxSources: Number($("limit-sources").value),
      timeoutMs: Number($("limit-timeout").value) * 1000,
    },
  };
}
function renderClients() {
  const container = $("clients-list");
  container.replaceChildren();
  if (!configuration.clients.length) {
    const p = document.createElement("p");
    p.textContent = "还没有接入凭据。";
    container.append(p);
    return;
  }
  for (const client of [...configuration.clients].reverse()) {
    const div = document.createElement("div");
    div.className = "client-item";
    const name = document.createElement("strong");
    name.textContent = client.name;
    const info = document.createElement("p");
    info.textContent = client.revokedAt
      ? "已撤销"
      : `有效至 ${new Date(client.expiresAt).toLocaleString()}`;
    div.append(name, info);
    if (!client.revokedAt) {
      const button = document.createElement("button");
      button.textContent = "撤销接入";
      button.onclick = async () => {
        if (button.dataset.confirming !== "yes") {
          button.dataset.confirming = "yes";
          button.textContent = "确认撤销";
          const warning = document.createElement("p");
          warning.textContent = "凭据将立即失效，运行中的请求会取消。";
          const cancel = document.createElement("button");
          cancel.textContent = "保留接入";
          cancel.onclick = () => {
            delete button.dataset.confirming;
            button.textContent = "撤销接入";
            warning.remove();
            cancel.remove();
          };
          div.append(warning, cancel);
          return;
        }
        button.disabled = true;
        try {
          await api(`clients/${client.id}/revoke`, "POST", {});
          configuration.clients = configuration.clients.map((c) =>
            c.id === client.id
              ? { ...c, revokedAt: new Date().toISOString() }
              : c,
          );
          $("issued-client").hidden = true;
          $("client-token").value = "";
          renderClients();
          message("接入已撤销");
        } catch (error) {
          message(error.message, true);
          button.disabled = false;
        }
      };
      div.append(button);
    }
    container.append(div);
  }
}
async function activity() {
  const result = await api("activity");
  $("daily-calls").textContent = result.rolling24h.calls;
  $("running-count").textContent = result.running;
  const tbody = $("activity-list");
  tbody.replaceChildren();
  const labels = {
    RUNNING: "处理中",
    SUCCEEDED: "等待收取",
    ACKNOWLEDGED: "已收取",
    FAILED: "失败",
    CANCELLED: "已取消",
    EXPIRED: "结果过期",
    INTERRUPTED: "服务中断",
  };
  for (const request of result.requests) {
    const row = document.createElement("tr");
    for (const value of [
      new Date(request.created).toLocaleString(),
      configuration.clients.find((c) => c.id === request.subject)?.name ??
        "已移除接入",
      labels[request.status] ?? request.status,
      request.calls,
    ]) {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      row.append(cell);
    }
    tbody.append(row);
  }
  if (!result.requests.length) {
    const row = document.createElement("tr"),
      cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = "暂无沉淀请求。连接测试不记为用户沉淀任务。";
    cell.className = "muted";
    row.append(cell);
    tbody.append(row);
  }
}
bind("login-form", "submit", async () => {
  if (!initialized && $("admin-password").value !== $("confirm-password").value)
    throw new Error("两次密码不一致");
  const result = await api(initialized ? "login" : "setup", "POST", {
    password: $("admin-password").value,
  });
  csrf = result.csrf;
  $("admin-password").value = "";
  $("confirm-password").value = "";
  await session();
});
bind("logout", "click", async () => {
  await api("logout", "POST", {});
  configuration = null;
  csrf = "";
  $("client-token").value = "";
  $("issued-client").hidden = true;
  await session();
});
bind("config-form", "submit", async () => {
  await api("config", "PUT", input());
  await load();
  $("test-result").hidden = true;
  message("配置已保存并启用");
});
bind("test-connection", "click", async () => {
  if (!$("config-form").reportValidity()) return;
  $("test-result").hidden = false;
  $("test-result").className = "inline-result";
  $("test-result").textContent = "正在发送固定检测文本…";
  $("save-config").disabled = true;
  try {
    const result = await api("test", "POST", input());
    $("test-result").textContent =
      `连接成功 · ${result.model} · ${(result.elapsedMs / 1000).toFixed(2)} 秒。请保存并启用配置。`;
  } catch (error) {
    $("test-result").className = "inline-result error";
    $("test-result").textContent = error.message;
  } finally {
    $("save-config").disabled = false;
  }
});
bind("client-form", "submit", async () => {
  const result = await api("clients", "POST", {
    name: $("client-name").value,
    days: Number($("client-days").value),
  });
  $("client-token").value = result.token;
  $("issued-client").hidden = false;
  const { token, ...client } = result;
  configuration.clients.push(client);
  renderClients();
  message("接入凭据已生成，仅显示一次");
});
bind("copy-client", "click", async () => {
  await navigator.clipboard.writeText($("client-token").value);
  message("已复制，请粘贴到桌面 Worket");
});
bind("refresh-activity", "click", activity);
document.querySelectorAll("[data-tab]").forEach(
  (button) =>
    (button.onclick = () => {
      showTab(button.dataset.tab);
      if (button.dataset.tab === "activity")
        void activity().catch((error) => message(error.message, true));
    }),
);
void session().catch((error) => message(error.message, true));
