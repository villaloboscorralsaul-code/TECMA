const { json, getAdminSessionFromEvent } = require("./_lib/common");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const session = getAdminSessionFromEvent(event);
    if (!session) {
      return json(401, {
        authenticated: false,
      });
    }

    return json(200, {
      authenticated: true,
      email: session.email || null,
      role: session.role || "admin",
    });
  } catch (err) {
    return json(500, { error: err.message || "Unexpected error" });
  }
};
