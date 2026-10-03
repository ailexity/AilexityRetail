// The e-mails the platform sends: a white-themed HTML template (table layout + inline styles, which is what mail clients
// render reliably) with a plain-text twin, and the messages built on it. Stores sign themselves up, so nothing here
// carries an activation key, a temporary password for a new account, or a plan.

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'SF Mono',Menlo,Consolas,'Liberation Mono',monospace";
const bar = (height) => `<td style="width:5px;height:${height}px;background:#171717;border-radius:3px 3px 1px 1px;font-size:0;line-height:0;">&nbsp;</td>`;

// greeting / title / intro are plain text; credentials are [label, value, hint?]; steps are plain strings; cta is { label, url }.
export function mailTemplate({ platform, greeting, title, intro, credentials = [], steps = [], cta = null, note = "" }) {
  const support = [platform.supportEmail, platform.supportPhone].filter(Boolean).join(" · ");
  const name = platform.platformName || "Ailexity Retail";
  const credentialRows = credentials.map(([label, value, hint], index) => `<tr><td style="padding:14px 18px;${index < credentials.length - 1 ? "border-bottom:1px solid #e6e5e0;" : ""}">
            <div style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#777777;">${escapeHtml(label)}</div>
            <div style="margin-top:6px;font-family:${MONO};font-size:20px;font-weight:700;letter-spacing:.04em;color:#171717;word-break:break-all;">${escapeHtml(value)}</div>
            ${hint ? `<div style="margin-top:4px;font-family:${FONT};font-size:12px;color:#777777;">${escapeHtml(hint)}</div>` : ""}
          </td></tr>`).join("");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;"><tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border:1px solid #e6e5e0;border-radius:18px;overflow:hidden;font-family:${FONT};color:#171717;">
    <tr><td style="background:#ffffff;padding:20px 28px;border-bottom:1px solid #eeede8;">
      <table role="presentation" cellspacing="0" cellpadding="0"><tr>
        <td valign="bottom" style="padding-right:12px;"><table role="presentation" cellspacing="0" cellpadding="0"><tr valign="bottom">${bar(12)}<td style="width:3px;"></td>${bar(20)}<td style="width:3px;"></td>${bar(16)}</tr></table></td>
        <td valign="middle" style="font-family:${FONT};font-size:15px;font-weight:800;letter-spacing:.06em;color:#171717;">${escapeHtml(name.toUpperCase())}</td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:28px 28px 6px;">
      <p style="margin:0 0 8px;font-size:13px;color:#777777;">${escapeHtml(greeting)}</p>
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;letter-spacing:-.02em;font-weight:800;">${escapeHtml(title)}</h1>
      <p style="margin:0;font-size:14.5px;line-height:1.6;color:#444444;">${escapeHtml(intro)}</p>
    </td></tr>
    ${credentials.length ? `<tr><td style="padding:18px 28px 4px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;border:1px solid #e6e5e0;border-radius:14px;">${credentialRows}</table></td></tr>` : ""}
    ${steps.length ? `<tr><td style="padding:18px 28px 4px;"><p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#777777;">Next steps</p><ol style="margin:0;padding-left:20px;font-size:14px;line-height:1.75;color:#333333;">${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol></td></tr>` : ""}
    ${cta ? `<tr><td style="padding:20px 28px 4px;"><a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:11px 22px;border:1px solid #171717;border-radius:10px;background:#ffffff;color:#171717;font-size:14px;font-weight:700;text-decoration:none;">${escapeHtml(cta.label)}</a></td></tr>` : ""}
    ${note ? `<tr><td style="padding:18px 28px 6px;font-size:12.5px;line-height:1.6;color:#777777;">${escapeHtml(note)}</td></tr>` : ""}
    <tr><td style="padding:18px 28px 26px;border-top:1px solid #eeede8;font-size:12px;line-height:1.6;color:#999999;">${escapeHtml(name)}${support ? ` · ${escapeHtml(support)}` : ""}<br>You received this because an account on ${escapeHtml(name)} was set up for this address. If you weren't expecting it, you can ignore this message.</td></tr>
  </table>
</td></tr></table>
</body></html>`;
  const text = [
    greeting, "", title, "", intro, "",
    ...credentials.map(([label, value, hint]) => `${label}: ${value}${hint ? `  (${hint})` : ""}`), credentials.length ? "" : null,
    ...(steps.length ? ["Next steps:", ...steps.map((step, index) => `${index + 1}. ${step}`), ""] : []),
    cta ? `${cta.label}: ${cta.url}` : null, cta ? "" : null,
    note || null, note ? "" : null,
    `— ${name}${support ? ` · ${support}` : ""}`,
  ].filter((line) => line !== null).join("\n");
  return { html, text };
}

export function welcomeMail({ user, platform, appUrl }) {
  const name = platform.platformName || "Ailexity Retail";
  return { subject: `Welcome to ${name} — ${user.storeName || user.name} is ready`, ...mailTemplate({
    platform, greeting: `Hi ${user.name},`, title: `Welcome to ${name}`,
    intro: `Your store account for ${user.storeName || user.name} is set up and already signed in on the device you created it from. Nothing to activate and nothing to pay — just add your items and start billing.`,
    credentials: [["Sign-in email", user.email], ["Store", user.storeName || user.name]],
    steps: ["Add your fastest-moving items under Items.", "Set your tax rate under Profile → Billing & invoices.", "Open Billing and ring up your first sale."],
    cta: appUrl ? { label: `Open ${name}`, url: appUrl } : null,
    note: "Keep this email private. If you ever forget your password, use Forgot? on the sign-in screen.",
  }) };
}

export function forgotPasswordMail({ user, temporaryPassword, platform, appUrl }) {
  const name = platform.platformName || "Ailexity Retail";
  return { subject: `${name}: your temporary password`, ...mailTemplate({
    platform, greeting: `Hi ${user.name},`, title: "Here is a temporary password",
    intro: `Someone asked to reset the password for ${user.email}. Sign in with the temporary password below and choose a new one straight away. If that was not you, ignore this email — your current password still works until this one is used.`,
    credentials: [["Temporary password", temporaryPassword]],
    steps: ["Sign in with your email and the temporary password.", "Go to Profile → Security and set a new password."],
    cta: appUrl ? { label: `Open ${name}`, url: appUrl } : null,
    note: "This password works until you set a new one.",
  }) };
}

export function resetMail({ user, temporaryPassword, platform, appUrl }) {
  const name = platform.platformName || "Ailexity Retail";
  return { subject: `${name}: your password was reset`, ...mailTemplate({
    platform, greeting: `Hi ${user.name},`, title: "Your password was reset",
    intro: `The ${name} team reset the password for ${user.email}. Sign in with the temporary password below and choose a new one straight away.`,
    credentials: [["Temporary password", temporaryPassword]],
    steps: ["Sign in with your email and the temporary password.", "Go to Profile → Security and set a new password."],
    cta: appUrl ? { label: `Open ${name}`, url: appUrl } : null,
    note: "If you did not ask for a reset, change your password as soon as you are signed in.",
  }) };
}
