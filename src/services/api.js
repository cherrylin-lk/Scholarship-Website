/** Dedicated API transport. Tokens stay in the caller's auth adapter, never in URLs. */
export class ApiError extends Error {
  constructor(message, status, requestId) { super(message); this.status = status; this.requestId = requestId; }
}

export function createApi({ baseUrl, getAccessToken = async () => null, fetchImpl = fetch, isSessionCurrent = () => true }) {
  if (!baseUrl) throw new Error('API URL is not configured.');
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) {
    throw new Error('API URL must use HTTPS (except loopback development).');
  }
  const request = async (path, { method = 'GET', body, query, signal, authenticated = true } = {}) => {
    const checkSession = () => { if (!isSessionCurrent()) throw new ApiError('Session changed.', 401); };
    checkSession();
    const target = new URL(`${url.href.replace(/\/$/, '')}${path}`);
    for (const [key, value] of Object.entries(query || {})) if (value !== '' && value != null) target.searchParams.set(key, value);
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (authenticated) {
      const token = await getAccessToken();
      if (!token) throw new ApiError('Sign in with Cognito to use this endpoint.', 401);
      headers.Authorization = `Bearer ${token}`;
    }
    checkSession(); // A queued/refreshing request must not send old data as a new user.
    const response = await fetchImpl(target.href, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
    let payload;
    try { payload = await response.json(); } catch { throw new ApiError('The API returned an invalid response.', response.status); }
    if (!response.ok) throw new ApiError(payload.message || 'API request failed.', response.status, payload.requestId);
    return payload;
  };
  const id = encodeURIComponent;
  return {
    forSession: guard => createApi({ baseUrl, getAccessToken, fetchImpl, isSessionCurrent: () => isSessionCurrent() && guard() }),
    listScholarships: (query, signal) => request('/scholarships', { query, signal, authenticated: false }),
    getScholarship: scholarshipId => request(`/scholarships/${id(scholarshipId)}`, { authenticated: false }),
    me: () => request('/me'),
    saveProfile: body => request('/me/profile', { method: 'PUT', body }),
    recommendations: () => request('/me/recommendations'),
    saved: () => request('/me/saved'),
    save: scholarshipId => request(`/me/saved/${id(scholarshipId)}`, { method: 'PUT' }),
    unsave: scholarshipId => request(`/me/saved/${id(scholarshipId)}`, { method: 'DELETE' }),
    applications: () => request('/me/applications'),
    saveApplication: (scholarshipId, body) => request(`/me/applications/${id(scholarshipId)}`, { method: 'PUT', body }),
    deleteApplication: scholarshipId => request(`/me/applications/${id(scholarshipId)}`, { method: 'DELETE' }),
    notifications: () => request('/me/notifications'),
    dismissNotification: notificationId => request(`/me/notifications/${id(notificationId)}/dismiss`, { method: 'POST' }),
    universityScholarships: () => request('/university/scholarships'),
    createScholarship: body => request('/university/scholarships', { method: 'POST', body }),
    updateScholarship: (scholarshipId, body) => request(`/university/scholarships/${id(scholarshipId)}`, { method: 'PUT', body }),
    unpublishScholarship: (scholarshipId, version) => request(`/university/scholarships/${id(scholarshipId)}/unpublish`, { method: 'POST', body: { version } }),
    adminScholarships: () => request('/admin/scholarships'),
    moderate: (scholarshipId, body) => request(`/admin/scholarships/${id(scholarshipId)}/moderation`, { method: 'POST', body }),
    adminUsers: () => request('/admin/users'),
    updateUser: (userId, body) => request(`/admin/users/${id(userId)}`, { method: 'PATCH', body }),
    statistics: () => request('/admin/statistics'),
    requestUpload: body => request('/documents/uploads', { method: 'POST', body }),
    completeUpload: documentId => request(`/documents/${id(documentId)}/complete`, { method: 'POST' }),
    documentDownload: documentId => request(`/documents/${id(documentId)}/download`),
  };
}
