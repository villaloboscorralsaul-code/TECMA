const {
  json,
  parseBody,
  getAdminCredentials,
  verifyAdminCredentials,
  createAdminSessionToken,
  buildAdminSessionCookie,
  getSupabaseAdmin,
  logAudit,
} = require("./_lib/common");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const { email, password } = parseBody(event);
    const adminCredentials = getAdminCredentials();

    if (!adminCredentials.email || !adminCredentials.password) {
      return json(500, {
        error: "Admin login credentials are not configured.",
      });
    }

    const isValid = verifyAdminCredentials({ email, password });
    if (!isValid) {
      return json(401, { error: "Credenciales inválidas." });
    }

    const token = createAdminSessionToken({ email: adminCredentials.email });
    if (!token) {
      return json(500, {
        error: "Admin session secret is not configured.",
      });
    }

    try {
      const supabase = getSupabaseAdmin();
      await logAudit(supabase, {
        actor: "ADMIN",
        action: "ADMIN_LOGIN_SUCCESS",
        metadata: {
          email: adminCredentials.email,
        },
      });
    } catch {
      // No-op. Authentication should not fail because of audit logging.
    }

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": buildAdminSessionCookie(token),
      },
      body: JSON.stringify({
        ok: true,
        email: adminCredentials.email,
      }),
    };
  } catch (err) {
    return json(500, { error: err.message || "Unexpected error" });
  }
};
