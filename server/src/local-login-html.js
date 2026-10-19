export function getLocalLoginHtml ({state, isError = false}) {
	const escapedState = state.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in — Campaign Hub</title><link rel="stylesheet" href="/css/hub-local-login.css"></head>
<body><main><p class="brand">5etools · Campaign Hub</p><h1>Sign in</h1>
<p>Use the username and password provided by your host.</p>
${isError ? "<p role=\"alert\" class=\"error\">Username or password is incorrect.</p>" : ""}
<form method="post" action="/auth/local/callback">
<input type="hidden" name="state" value="${escapedState}">
<label for="username">Username</label><input id="username" name="username" autocomplete="username" maxlength="64" required autofocus>
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="256" required>
<button type="submit">Sign in</button></form><a href="/hub.html">Back to Campaign Hub</a>
</main></body></html>`;
}
