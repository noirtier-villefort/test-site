(() => {
  "use strict";

  const STORAGE_KEY = "shift-tracker-v1";
  const DEFAULT_SETTINGS = { rate: 30, shiftHours: 8, currency: "PLN" };
  const ALLOWED_CURRENCIES = ["PLN", "EUR", "USD", "GBP", "UAH", "CZK"];

  const $ = (id) => document.getElementById(id);
  const els = {
    statusBadge: $("statusBadge"),
    earnings: $("earnings"),
    liveText: $("liveText"),
    progressBar: $("progressBar"),
    elapsedLabel: $("elapsedLabel"),
    targetLabel: $("targetLabel"),
    duration: $("duration"),
    rateLabel: $("rateLabel"),
    forecast: $("forecast"),
    breakDuration: $("breakDuration"),
    startBtn: $("startBtn"),
    activeControls: $("activeControls"),
    pauseBtn: $("pauseBtn"),
    finishBtn: $("finishBtn"),
    resumeBtn: $("resumeBtn"),
    newShiftBtn: $("newShiftBtn"),
    settingsPanel: $("settingsPanel"),
    settingsForm: $("settingsForm"),
    rateInput: $("rateInput"),
    hoursInput: $("hoursInput"),
    currencyInput: $("currencyInput"),
    currencySuffix: $("currencySuffix"),
    historyList: $("historyList"),
    clearHistoryBtn: $("clearHistoryBtn"),
    toast: $("toast")
  };

  const telegram = window.Telegram && window.Telegram.WebApp;
  if (telegram) {
    telegram.ready();
    telegram.expand();
    try {
      if (telegram.setHeaderColor) telegram.setHeaderColor("secondary_bg_color");
      if (telegram.setBackgroundColor) telegram.setBackgroundColor("bg_color");
    } catch (_) {}
  }

  let toastTimeout;
  let state = loadState();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { settings: { ...DEFAULT_SETTINGS }, activeShift: null, history: [] };
      const parsed = JSON.parse(raw);
      const settings = parsed.settings || {};
      return {
        settings: {
          rate: validNumber(settings.rate, DEFAULT_SETTINGS.rate, 0.01, 1000000),
          shiftHours: validNumber(settings.shiftHours, DEFAULT_SETTINGS.shiftHours, 0.25, 24),
          currency: ALLOWED_CURRENCIES.includes(settings.currency) ? settings.currency : DEFAULT_SETTINGS.currency
        },
        activeShift: isValidShift(parsed.activeShift) ? parsed.activeShift : null,
        history: Array.isArray(parsed.history) ? parsed.history.filter(isValidHistoryItem).slice(0, 100) : []
      };
    } catch (error) {
      console.warn("Не удалось прочитать сохранённые данные:", error);
      return { settings: { ...DEFAULT_SETTINGS }, activeShift: null, history: [] };
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("Не удалось сохранить данные:", error);
      showToast("Не удалось сохранить данные. Проверь свободное место в браузере.");
    }
  }

  function validNumber(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
  }

  function isValidShift(shift) {
    return !!shift &&
      ["running", "paused"].includes(shift.status) &&
      Number.isFinite(shift.startedAt) &&
      Number.isFinite(shift.rate) && shift.rate >= 0 &&
      Number.isFinite(shift.shiftHours) && shift.shiftHours > 0 &&
      Number.isFinite(shift.accumulatedMs) && shift.accumulatedMs >= 0 &&
      (shift.status !== "running" || Number.isFinite(shift.resumedAt));
  }

  function isValidHistoryItem(item) {
    return !!item && Number.isFinite(item.startedAt) &&
      Number.isFinite(item.endedAt) && Number.isFinite(item.earnings) &&
      Number.isFinite(item.paidMs) && typeof item.currency === "string";
  }

  function getElapsedMs(shift, now = Date.now()) {
    if (!shift) return 0;
    if (shift.status === "running") {
      return shift.accumulatedMs + Math.max(0, now - shift.resumedAt);
    }
    return shift.accumulatedMs;
  }

  function getBreakMs(shift, now = Date.now()) {
    if (!shift) return 0;
    const wallTime = Math.max(0, (shift.endedAt || now) - shift.startedAt);
    return Math.max(0, wallTime - getElapsedMs(shift, now));
  }

  function getEarnings(shift, now = Date.now()) {
    return shift ? shift.rate * getElapsedMs(shift, now) / 3600000 : 0;
  }

  function money(amount, currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(amount);
    } catch (_) {
      return `${amount.toFixed(2)} ${currency}`;
    }
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map((n) => String(n).padStart(2, "0")).join(":");
  }

  function formatHoursAndMinutes(ms) {
    const totalMinutes = Math.floor(Math.max(0, ms) / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours} ч ${String(minutes).padStart(2, "0")} мин`;
  }

  function formatDate(timestamp) {
    return new Date(timestamp).toLocaleString(undefined, {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => { els.toast.hidden = true; }, 2800);
  }

  function updateStatusBadge(status) {
    const labels = {
      idle: "Не начата",
      running: "Смена идёт",
      paused: "На паузе",
      completed: "Завершена"
    };
    els.statusBadge.textContent = labels[status] || labels.idle;
    els.statusBadge.dataset.status = status;
  }

  function render() {
    const shift = state.activeShift;
    const settings = state.settings;
    const now = Date.now();

    if (shift) {
      const elapsedMs = getElapsedMs(shift, now);
      const breakMs = getBreakMs(shift, now);
      const targetMs = shift.shiftHours * 3600000;
      const earnings = getEarnings(shift, now);
      const progress = Math.min(100, targetMs > 0 ? elapsedMs / targetMs * 100 : 0);

      els.earnings.textContent = money(earnings, shift.currency);
      els.duration.textContent = formatDuration(elapsedMs);
      els.rateLabel.textContent = `${money(shift.rate, shift.currency)}/ч`;
      els.forecast.textContent = money(shift.rate * shift.shiftHours, shift.currency);
      els.breakDuration.textContent = formatDuration(breakMs);
      els.elapsedLabel.textContent = `${formatHoursAndMinutes(elapsedMs)} оплачено`;
      els.targetLabel.textContent = elapsedMs >= targetMs
        ? `План ${formatHoursAndMinutes(targetMs)} выполнен`
        : `План: ${formatHoursAndMinutes(targetMs)}`;
      els.progressBar.style.width = `${progress}%`;
      els.liveText.textContent = shift.status === "running"
        ? (elapsedMs >= targetMs ? "Сверхурочные часы учитываются" : "Заработок растёт в реальном времени")
        : "Начисление приостановлено";
      els.liveText.previousElementSibling.classList.toggle("is-live", shift.status === "running");
      updateStatusBadge(shift.status);

      els.startBtn.hidden = true;
      els.activeControls.hidden = shift.status !== "running";
      els.pauseBtn.hidden = shift.status !== "running";
      els.resumeBtn.hidden = shift.status !== "paused";
      els.newShiftBtn.hidden = true;
    } else {
      els.earnings.textContent = money(0, settings.currency);
      els.duration.textContent = "00:00:00";
      els.rateLabel.textContent = `${money(settings.rate, settings.currency)}/ч`;
      els.forecast.textContent = money(settings.rate * settings.shiftHours, settings.currency);
      els.breakDuration.textContent = "00:00:00";
      els.elapsedLabel.textContent = "0 ч 00 мин оплачено";
      els.targetLabel.textContent = `План: ${formatHoursAndMinutes(settings.shiftHours * 3600000)}`;
      els.progressBar.style.width = "0%";
      els.liveText.textContent = "Готов к началу";
      els.liveText.previousElementSibling.classList.remove("is-live");
      updateStatusBadge(state.history.length ? "completed" : "idle");
      els.startBtn.hidden = false;
      els.activeControls.hidden = true;
      els.resumeBtn.hidden = true;
      els.newShiftBtn.hidden = true;
    }

    renderHistory();
  }

  function renderHistory() {
    const history = state.history;
    els.clearHistoryBtn.hidden = history.length === 0;
    els.historyList.replaceChildren();

    if (history.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const icon = document.createElement("div");
      icon.className = "empty-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "◷";
      const title = document.createElement("p");
      title.textContent = "Здесь появятся завершённые смены";
      const subtitle = document.createElement("span");
      subtitle.textContent = "Начни первую смену, чтобы увидеть историю";
      empty.append(icon, title, subtitle);
      els.historyList.append(empty);
      return;
    }

    history.forEach((item) => {
      const card = document.createElement("article");
      card.className = "history-item";
      const details = document.createElement("div");
      const date = document.createElement("p");
      date.className = "history-date";
      date.textContent = formatDate(item.startedAt);
      const meta = document.createElement("p");
      meta.className = "history-meta";
      meta.textContent = `${formatHoursAndMinutes(item.paidMs)} оплачено · перерывы ${formatDuration(item.breakMs)} · ${money(item.rate, item.currency)}/ч`;
      const amount = document.createElement("div");
      amount.className = "history-amount";
      amount.textContent = money(item.earnings, item.currency);
      details.append(date, meta);
      card.append(details, amount);
      els.historyList.append(card);
    });
  }

  function startShift() {
    if (state.activeShift) return;
    const now = Date.now();
    state.activeShift = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      status: "running",
      startedAt: now,
      resumedAt: now,
      endedAt: null,
      accumulatedMs: 0,
      rate: state.settings.rate,
      shiftHours: state.settings.shiftHours,
      currency: state.settings.currency
    };
    persist();
    render();
    showToast("Смена началась. Удачной работы!");
  }

  function pauseShift() {
    const shift = state.activeShift;
    if (!shift || shift.status !== "running") return;
    const now = Date.now();
    shift.accumulatedMs = getElapsedMs(shift, now);
    shift.status = "paused";
    shift.resumedAt = null;
    persist();
    render();
    showToast("Пауза включена — время не оплачивается.");
  }

  function resumeShift() {
    const shift = state.activeShift;
    if (!shift || shift.status !== "paused") return;
    shift.status = "running";
    shift.resumedAt = Date.now();
    persist();
    render();
    showToast("Смена продолжается.");
  }

  function finishShift() {
    const shift = state.activeShift;
    if (!shift) return;
    const confirmed = telegram && typeof telegram.showPopup === "function"
      ? null
      : window.confirm("Завершить смену и сохранить результат в истории?");
    if (confirmed === false) return;

    const finish = () => {
      const now = Date.now();
      const paidMs = getElapsedMs(shift, now);
      const breakMs = Math.max(0, now - shift.startedAt - paidMs);
      state.history.unshift({
        id: shift.id,
        startedAt: shift.startedAt,
        endedAt: now,
        paidMs,
        breakMs,
        rate: shift.rate,
        shiftHours: shift.shiftHours,
        currency: shift.currency,
        earnings: shift.rate * paidMs / 3600000
      });
      state.history = state.history.slice(0, 100);
      state.activeShift = null;
      persist();
      render();
      showToast("Смена завершена и добавлена в историю.");
    };

    if (telegram && typeof telegram.showPopup === "function") {
      telegram.showPopup({
        title: "Завершить смену?",
        message: "Результат будет сохранён в истории.",
        buttons: [
          { id: "cancel", type: "cancel", text: "Отмена" },
          { id: "finish", type: "destructive", text: "Завершить" }
        ]
      }, (buttonId) => {
        if (buttonId === "finish") finish();
      });
    } else {
      finish();
    }
  }

  function saveSettings(event) {
    event.preventDefault();
    const rate = Number(els.rateInput.value);
    const shiftHours = Number(els.hoursInput.value);
    const currency = els.currencyInput.value;

    if (!Number.isFinite(rate) || rate < 0.01 || rate > 1000000) {
      showToast("Ставка должна быть от 0,01 до 1 000 000.");
      els.rateInput.focus();
      return;
    }
    if (!Number.isFinite(shiftHours) || shiftHours < 0.25 || shiftHours > 24) {
      showToast("Длительность смены должна быть от 0,25 до 24 часов.");
      els.hoursInput.focus();
      return;
    }
    if (!ALLOWED_CURRENCIES.includes(currency)) {
      showToast("Выбери валюту из списка.");
      return;
    }

    state.settings = { rate, shiftHours, currency };
    persist();
    render();
    els.settingsPanel.open = false;
    showToast("Настройки сохранены.");
  }

  function populateSettings() {
    els.rateInput.value = String(state.settings.rate);
    els.hoursInput.value = String(state.settings.shiftHours);
    els.currencyInput.value = state.settings.currency;
    els.currencySuffix.textContent = `${state.settings.currency}/ч`;
  }

  els.startBtn.addEventListener("click", startShift);
  els.pauseBtn.addEventListener("click", pauseShift);
  els.resumeBtn.addEventListener("click", resumeShift);
  els.finishBtn.addEventListener("click", finishShift);
  els.settingsForm.addEventListener("submit", (event) => {
    saveSettings(event);
    els.currencySuffix.textContent = `${els.currencyInput.value}/ч`;
  });
  els.currencyInput.addEventListener("change", () => {
    els.currencySuffix.textContent = `${els.currencyInput.value}/ч`;
  });
  els.clearHistoryBtn.addEventListener("click", () => {
    if (!window.confirm("Удалить всю историю смен? Это действие нельзя отменить.")) return;
    state.history = [];
    persist();
    render();
    showToast("История очищена.");
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) render();
  });
  window.addEventListener("pageshow", render);
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
      state = loadState();
      populateSettings();
      render();
    }
  });

  populateSettings();
  render();
  setInterval(render, 250);
})(); 
