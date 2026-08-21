async function sendNtfyNotification(settings, { title, message, tags }) {
  if (!settings.ntfyEnabled || !settings.ntfyTopic) return;

  const url = `${settings.ntfyServer.replace(/\/+$/, "")}/${encodeURIComponent(settings.ntfyTopic)}`;
  const headers = { Title: title };
  if (tags) headers.Tags = tags;

  await fetch(url, { method: "POST", headers, body: message });
}

module.exports = { sendNtfyNotification };
