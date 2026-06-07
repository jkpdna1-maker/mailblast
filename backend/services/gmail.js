const { google } = require('googleapis');
require('dotenv').config();

function createOAuthClient() {
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'https://mailblast-mobile-backend.onrender.com/auth/google/callback' || 'https://mailblast-mobile-backend.onrender.com/auth/google/callback';
  console.log('[gmail] Using redirect URI:', redirectUri);
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

function getAuthUrl(redirectUri, state) {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    redirect_uri: redirectUri || undefined,
    state: state || undefined,
    scope: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ]
  });
}

async function getTokensFromCode(code, redirectUri) {
  const client = createOAuthClient();
  if (redirectUri) client.redirectUri = redirectUri;
  const { tokens } = await client.getToken(code);
  return tokens;
}

async function getUserInfo(tokens) {
  const client = createOAuthClient();
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();
  return data;
}

function getGmailClient(tokens) {
  const client = createOAuthClient();
  client.setCredentials(tokens);
  return google.gmail({ version: 'v1', auth: client });
}

module.exports = { getAuthUrl, getTokensFromCode, getUserInfo, getGmailClient };
