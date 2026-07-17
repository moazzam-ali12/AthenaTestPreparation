const appUrl = process.env.APP_URL ?? "https://athena-pov.com";

export function welcomeEmailHtml({ displayName }: { displayName: string }) {
  return {
    subject: "Welcome to Athena!",
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <tr>
      <td style="padding:40px 32px;text-align:center;">
        <h1 style="margin:0 0 16px;font-size:24px;color:#111827;">Welcome to Athena, ${displayName}!</h1>
        <p style="margin:0 0 24px;font-size:16px;color:#4b5563;line-height:1.6;">
          You're all set to start your CPA exam prep journey. Athena uses AI-powered lessons, quizzes, and tutoring to help you pass every section.
        </p>
        <a href="${appUrl}/dashboard" style="display:inline-block;padding:12px 32px;background:#6366f1;color:#ffffff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:600;">
          Go to Dashboard
        </a>
        <p style="margin:24px 0 0;font-size:14px;color:#9ca3af;">
          If you have any questions, just open the Mentor chat in the app.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}

export function dailyReminderHtml({
  displayName,
  startTime,
}: {
  displayName: string;
  startTime: string;
}) {
  return {
    subject: `⏰ Your CPA study session starts in 1 hour`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <tr>
      <td style="padding:40px 32px;text-align:center;">
        <div style="font-size:48px;margin-bottom:16px;">⏰</div>
        <h1 style="margin:0 0 8px;font-size:22px;color:#111827;">Almost time, ${displayName}!</h1>
        <p style="margin:0 0 8px;font-size:16px;color:#4b5563;line-height:1.6;">
          Your study session starts at <strong>${startTime}</strong> — that's in about an hour.
        </p>
        <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6;">
          Grab some water, find a quiet spot, and get ready to make progress toward your CPA license.
        </p>
        <a href="${appUrl}/dashboard" style="display:inline-block;padding:12px 32px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:600;">
          Go to Dashboard
        </a>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}

export function streakAlertHtml({
  displayName,
  streak,
}: {
  displayName: string;
  streak: number;
}) {
  return {
    subject: `🔥 Don't lose your ${streak}-day streak!`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <tr>
      <td style="padding:40px 32px;text-align:center;">
        <div style="font-size:48px;margin-bottom:16px;">🔥</div>
        <h1 style="margin:0 0 8px;font-size:22px;color:#111827;">Don't break the chain, ${displayName}!</h1>
        <p style="margin:0 0 8px;font-size:16px;color:#4b5563;line-height:1.6;">
          You have a <strong>${streak}-day streak</strong> on the line.
        </p>
        <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6;">
          Complete today's daily quest before midnight to keep it alive. It only takes a few minutes.
        </p>
        <a href="${appUrl}/dashboard" style="display:inline-block;padding:12px 32px;background:#dc2626;color:#ffffff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:600;">
          Complete Today's Quest
        </a>
        <p style="margin:24px 0 0;font-size:13px;color:#9ca3af;">
          Streaks reset at midnight in your local time.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}

export function sessionReminderHtml({
  displayName,
  startTime,
}: {
  displayName: string;
  startTime: string;
}) {
  return {
    subject: `Your study session starts at ${startTime}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <tr>
      <td style="padding:40px 32px;text-align:center;">
        <h1 style="margin:0 0 16px;font-size:24px;color:#111827;">Hey ${displayName}!</h1>
        <p style="margin:0 0 24px;font-size:16px;color:#4b5563;line-height:1.6;">
          Your study session is coming up at <strong>${startTime}</strong>. Jump in and keep your streak going!
        </p>
        <a href="${appUrl}/dashboard" style="display:inline-block;padding:12px 32px;background:#6366f1;color:#ffffff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:600;">
          Start Session
        </a>
        <p style="margin:24px 0 0;font-size:14px;color:#9ca3af;">
          Consistency is the key to passing the CPA Exam. You've got this!
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}
