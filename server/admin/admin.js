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
  for (const name of ["model", "clients", "activity", "samples"])
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
    $("samples-list").replaceChildren();
    $("sample-detail").replaceChildren();
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
function configBusy(busy) {
  for (const id of ["save-config", "save-limits", "test-connection"]) $(id).disabled = busy;
}
function limitsStatus(text) {
  $("limits-save-status").textContent = text;
  $("limits-save-status").hidden = false;
}
for (const id of ["limit-daily", "limit-user", "limit-global", "limit-sources", "limit-timeout"]) {
  $(id).addEventListener("input", () => limitsStatus("调用额度已修改，尚未保存"));
}
bind("config-form", "submit", async () => {
  configBusy(true);
  limitsStatus("正在保存…");
  try {
    await api("config", "PUT", input());
    await load();
    $("test-result").hidden = true;
    limitsStatus("调用额度已保存并启用");
    message("配置已保存并启用");
  } catch (error) {
    limitsStatus(`保存失败：${error.message}`);
    throw error;
  } finally {
    configBusy(false);
  }
});
bind("test-connection", "click", async () => {
  if (!$("config-form").reportValidity()) return;
  $("test-result").hidden = false;
  $("test-result").className = "inline-result";
  $("test-result").textContent = "正在发送固定检测文本…";
  configBusy(true);
  try {
    const result = await api("test", "POST", input());
    $("test-result").textContent =
      `连接成功 · ${result.model} · ${(result.elapsedMs / 1000).toFixed(2)} 秒。请保存并启用配置。`;
  } catch (error) {
    $("test-result").className = "inline-result error";
    $("test-result").textContent = error.message;
  } finally {
    configBusy(false);
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
      if (button.dataset.tab === "samples") void samples().catch(error => message(error.message, true));
      if (button.dataset.tab === "activity")
        void activity().catch((error) => message(error.message, true));
    }),
);
void session().catch((error) => message(error.message, true));

let collectionPolicy;
const eventLabels = { RECORDING: "所选工作对话", MESSAGE: "用户消息 / AI 回复", SOURCE: "所选材料与来源证据", REUSE: "新工作范围", CANDIDATE: "模型候选原稿", EDIT: "用户保存的修改", PUBLISH: "用户确认发布", STATUS: "任务状态与结果", ACCEPTANCE: "用户验收" };
function element(tag, text, parent) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (parent) parent.append(node);
  return node;
}
async function samples() {
  const result = await api("samples");
  collectionPolicy = result.policy;
  $("samples-policy").textContent = `${result.policy.enabled ? "正在接收授权样本" : "已暂停接收"} · 授权起 ${result.policy.retentionDays} 天后删除 · ${result.items.length} 份样本`;
  $("toggle-collection").textContent = result.policy.enabled ? "暂停接收新数据" : "恢复接收授权数据";
  const list = $("samples-list");
  list.replaceChildren();
  if (!result.items.length) element("p", "暂无已授权样本。", list);
  for (const sample of result.items) {
    const row = element("div", undefined, list);
    row.className = "client-item";
    const button = element("button", `${sample.consent.scope === "RECORDING" ? "工作记录" : sample.consent.scope === "REUSE" ? "工作复用" : "工作沉淀"} · ${new Date(sample.created).toLocaleString()}`, row);
    element("p", `${configuration.clients.find(c => c.id === sample.subject)?.name ?? sample.subject} · ${sample.eventCount} 条证据 · ${sample.review.status === "REVIEWED" ? "已评审" : "待评审"}`, row);
    button.onclick = () => void sampleDetail(sample.id).catch(e => message(e.message, true));
  }
}
async function sampleDetail(id) {
  const sample = await api(`samples/${id}`);
  const panel = $("sample-detail");
  panel.hidden = false;
  panel.replaceChildren();
  element("h2", "样本详情", panel);
  element("p", `授权：${sample.consent.version} · ${sample.consent.at}；删除期限：${new Date(sample.expires).toLocaleString()}`, panel);
  const close = element("button", "关闭详情", panel);
  close.onclick = () => { panel.replaceChildren(); panel.hidden = true; };
  const label = element("label", "评审备注", panel);
  const note = element("textarea", undefined, label);
  note.value = sample.review.note;
  note.maxLength = 10000;
  const statusLabel = element("label", "评审状态", panel);
  const status = element("select", undefined, statusLabel);
  for (const [value, name] of [["DRAFT", "待评审"], ["REVIEWED", "已评审"]]) {
    const option = element("option", name, status); option.value = value;
  }
  status.value = sample.review.status;
  const save = element("button", "保存评审", panel);
  save.onclick = async () => {
    save.disabled = true;
    try { await api(`samples/${id}`, "PUT", { status: status.value, note: note.value }); await samples(); message("评审已保存"); }
    catch (error) { message(error.message, true); }
    finally { save.disabled = false; }
  };
  const remove = element("button", "删除此样本", panel);
  remove.onclick = () => {
    remove.disabled = true;
    const confirmation = element("div", undefined, panel);
    element("p", "将删除所选材料、候选、修改、验收和评审备注。原始本机工作保留。", confirmation);
    const yes = element("button", "确认删除样本", confirmation);
    const no = element("button", "保留样本", confirmation);
    no.onclick = () => { confirmation.remove(); remove.disabled = false; };
    yes.onclick = async () => {
      yes.disabled = true;
      try { await api(`samples/${id}`, "DELETE"); panel.replaceChildren(); panel.hidden = true; await samples(); message("样本已删除"); }
      catch (error) { message(error.message, true); yes.disabled = false; }
    };
  };
  for (const event of sample.events) {
    const detail = element("details", undefined, panel);
    element("summary", `${eventLabels[event.kind] ?? event.kind} · ${new Date(event.at).toLocaleString()}`, detail);
    renderData(event.data, detail);
  }
}
function renderData(data, parent, depth = 0) {
  if (data === null || typeof data !== "object") { element("p", String(data ?? "—"), parent); return; }
  if (depth > 8) { element("pre", JSON.stringify(data, null, 2), parent); return; }
  if (Array.isArray(data)) {
    for (const [index, value] of data.entries()) {
      const group = element("section", undefined, parent);
      element("h4", `第 ${index + 1} 项`, group);
      renderData(value, group, depth + 1);
    }
    return;
  }
  const names = { content: "内容", request: "选定来源", sources: "来源", events: "事件", sourceRefs: "来源映射", refs: "依据", purpose: "目的", inputs: "输入", deliverables: "交付", constraints: "要求", acceptanceCriteria: "验收标准", methods: "方法", issues: "问题", resolutions: "用户处理", criteriaResults: "逐项验收", text: "文本", basis: "依据分类", name: "名称", status: "状态", revision: "修订版本" };
  for (const [key, value] of Object.entries(data)) {
    const detail = element("details", undefined, parent);
    element("summary", names[key] ?? key, detail);
    if (depth < 2 || typeof value !== "object" || value === null) detail.open = true;
    renderData(value, detail, depth + 1);
  }
}
bind("refresh-samples", "click", async () => { $("sample-detail").replaceChildren(); $("sample-detail").hidden = true; await samples(); });
bind("toggle-collection", "click", async () => { await api("samples-policy", "PUT", { enabled: !collectionPolicy.enabled }); await samples(); });
