import axios from 'axios';

const BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: BASE + '/campaigns',
  withCredentials: true
});
const auth = axios.create({
  baseURL: BASE + '/auth',
  withCredentials: true
});
export const getMe = () => auth.get('/me').then(r => r.data.user);
export const resendAll = (id) => new EventSource(`${BASE}/campaigns/${id}/resend-all`, { withCredentials: true });
export const logout = () => auth.post('/logout');
export const getCampaigns = () => api.get('/').then(r => r.data);
export const createCampaign = (data) => api.post('/', data).then(r => r.data);
export const getCampaign = (id) => api.get(`/${id}`).then(r => r.data);
export const updateCampaign = (id, data) => api.put(`/${id}`, data).then(r => r.data);
export const uploadRecipients = (id, file) => {
  const form = new FormData();
  form.append('file', file);
  return api.post(`/${id}/recipients/upload`, form).then(r => r.data);
};
export const pasteRecipients = (id, text) =>
  api.post(`/${id}/recipients/paste`, { text }).then(r => r.data);
export const uploadAttachment = (id, file) => {
  const form = new FormData();
  form.append('pdf', file);
  return api.post(`/${id}/attachments`, form).then(r => r.data);
};
export const deleteAttachment = (campaignId, attId) =>
  api.delete(`/${campaignId}/attachments/${attId}`).then(r => r.data);
export const scheduleCampaign = (id, scheduled_at) =>
  api.post(`/${id}/schedule`, { scheduled_at }).then(r => r.data);
export const cancelSchedule = (id) =>
  api.delete(`/${id}/schedule`).then(r => r.data);
export const sendNow = (id) => new EventSource(`${BASE}/campaigns/${id}/send`, { withCredentials: true });
export const resendFailed = (id) => new EventSource(`${BASE}/campaigns/${id}/resend-failed`, { withCredentials: true });
export const sendTestEmail = (id, email) => api.post(`/${id}/test`, { test_email: email }).then(r => r.data);
export const getResendRules = (id) => api.get(`/${id}/resend-rules`).then(r => r.data);
export const createResendRule = (id, type, delay_minutes) => api.post(`/${id}/resend-rules`, { type, delay_minutes }).then(r => r.data);
export const deleteResendRule = (id, ruleId) => api.delete(`/${id}/resend-rules/${ruleId}`).then(r => r.data);
export const deleteCampaign = (id) => api.delete(`/${id}`).then(r => r.data);
