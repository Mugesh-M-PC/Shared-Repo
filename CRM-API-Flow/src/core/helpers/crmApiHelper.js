function createCrmApiError(category, message) {
  const error = new Error(message);
  error.category = category;
  return error;
}

function getCrmApiUrl(baseUrl, endpoint) {
  const normalizedBaseUrl = String(baseUrl || '').trim();

  if (!normalizedBaseUrl) {
    throw createCrmApiError(
      'MISSING_CONFIGURATION',
      'CRM_BASE_URL is not configured.'
    );
  }

  try {
    const baseUrlWithSlash = normalizedBaseUrl.endsWith('/')
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/`;

    return new URL(endpoint, baseUrlWithSlash).toString();
  } catch (error) {
    throw createCrmApiError(
      'MISSING_CONFIGURATION',
      `CRM_BASE_URL is invalid: ${error.message}`
    );
  }
}

function getCustomerDetailsUrl(baseUrl, tokenId) {
  const normalizedTokenId = String(tokenId || '').trim();

  if (!normalizedTokenId) {
    throw createCrmApiError(
      'MISSING_DATA',
      'CRM token ID is missing.'
    );
  }

  const url = new URL(
    getCrmApiUrl(baseUrl, 'custdetails.php')
  );
  url.searchParams.set('tokenid', normalizedTokenId);

  return url.toString();
}

function getCrmRequestConfig(options = {}) {
  const baseUrl = options.baseUrl || process.env.CRM_BASE_URL;
  const apiKey = String(
    options.apiKey || process.env.CRM_API_KEY || ''
  ).trim();
  const timeout = Number(options.timeout ?? 30_000);

  if (!apiKey) {
    throw createCrmApiError(
      'MISSING_CONFIGURATION',
      'CRM_API_KEY is not configured.'
    );
  }

  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw createCrmApiError(
      'MISSING_CONFIGURATION',
      'CRM API timeout must be a positive number.'
    );
  }

  return {
    apiKey,
    baseUrl,
    timeout,
  };
}

function getCrmHeaders(apiKey) {
  return {
    'X-API-Key': apiKey,
  };
}

function formatCrmDate(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();

  return `${day}-${month}-${year}`;
}

function normalizeCrmDate(value, fieldName) {
  const normalized = String(value || '').trim();
  const match = normalized.match(
    /^(\d{2})-(\d{2})-(\d{4})$/
  );

  if (!match) {
    throw createCrmApiError(
      'MISSING_CONFIGURATION',
      `${fieldName} must use dd-MM-yyyy format.`
    );
  }

  const [, day, month, year] = match;
  const parsedDate = new Date(
    Number(year),
    Number(month) - 1,
    Number(day)
  );

  if (
    parsedDate.getFullYear() !== Number(year) ||
    parsedDate.getMonth() !== Number(month) - 1 ||
    parsedDate.getDate() !== Number(day)
  ) {
    throw createCrmApiError(
      'MISSING_CONFIGURATION',
      `${fieldName} is not a valid date.`
    );
  }

  return normalized;
}

function getLastEightDaysDateRange(referenceDate = new Date()) {
  const endDateValue = new Date(referenceDate);

  if (Number.isNaN(endDateValue.getTime())) {
    throw createCrmApiError(
      'MISSING_CONFIGURATION',
      'CRM date-range reference date is invalid.'
    );
  }

  const startDateValue = new Date(endDateValue);
  startDateValue.setDate(startDateValue.getDate() - 7);

  return {
    startDate: formatCrmDate(startDateValue),
    endDate: formatCrmDate(endDateValue),
  };
}

async function fetchCrmCustomerDetails(
  request,
  tokenId,
  options = {}
) {
  if (!request || typeof request.get !== 'function') {
    throw createCrmApiError(
      'MISSING_CONFIGURATION',
      'A Playwright API request context is required.'
    );
  }

  const {
    apiKey,
    baseUrl,
    timeout,
  } = getCrmRequestConfig(options);

  const apiUrl = getCustomerDetailsUrl(baseUrl, tokenId);
  let response;

  try {
    response = await request.get(apiUrl, {
      headers: getCrmHeaders(apiKey),
      timeout,
    });
  } catch (error) {
    throw createCrmApiError(
      'CRM_API_ERROR',
      `CRM details request failed for token ${tokenId}: ` +
      error.message
    );
  }

  const responseText = await response.text().catch(() => '');

  if (!response.ok()) {
    throw createCrmApiError(
      'CRM_API_ERROR',
      `CRM details API returned ${response.status()} ` +
      `${response.statusText()} for token ${tokenId}. ` +
      `Response: ${responseText.slice(0, 500)}`
    );
  }

  let detailsData;

  try {
    detailsData = JSON.parse(responseText);
  } catch (error) {
    throw createCrmApiError(
      'MISSING_DATA',
      `CRM details API returned invalid JSON for token ` +
      `${tokenId}: ${error.message}. ` +
      `Response: ${responseText.slice(0, 500)}`
    );
  }

  if (
    !detailsData ||
    detailsData.status !== true ||
    !detailsData.data
  ) {
    throw createCrmApiError(
      'MISSING_DATA',
      `CRM details API returned an invalid data structure ` +
      `for token ${tokenId}.`
    );
  }

  return detailsData;
}

async function fetchCrmVerificationList(
  request,
  options = {}
) {
  if (!request || typeof request.get !== 'function') {
    throw createCrmApiError(
      'MISSING_CONFIGURATION',
      'A Playwright API request context is required.'
    );
  }

  const {
    apiKey,
    baseUrl,
    timeout,
  } = getCrmRequestConfig(options);
  const clientId = String(
    options.clientId || process.env.CRM_CLIENT_ID || ''
  ).trim();
  const addType = String(
    options.addType || ''
  ).trim().toLowerCase();
  const status = String(options.status || '')
    .trim().toLowerCase();
  const dumpType = String(options.dumpType || 'all')
    .trim().toLowerCase();
  const callType = String(options.callType || 'list')
    .trim().toLowerCase();
  const dateFrom = normalizeCrmDate(
    options.dateFrom,
    'dateFrom'
  );
  const dateTo = normalizeCrmDate(
    options.dateTo,
    'dateTo'
  );

  if (!clientId) {
    throw createCrmApiError(
      'MISSING_CONFIGURATION',
      'CRM_CLIENT_ID is not configured.'
    );
  }

  if (!addType) {
    throw createCrmApiError(
      'MISSING_CONFIGURATION',
      'CRM addType is required.'
    );
  }

  const apiUrl = new URL(
    getCrmApiUrl(baseUrl, 'custdetails.php')
  );
  apiUrl.searchParams.set('clientid', clientId);
  apiUrl.searchParams.set('dat1', dateFrom);
  apiUrl.searchParams.set('dat2', dateTo);
  apiUrl.searchParams.set('dumptype', dumpType);
  apiUrl.searchParams.set('calltype', callType);
  if (status) {
    apiUrl.searchParams.set('status', status);
  }
  apiUrl.searchParams.set('addtype', addType);

  let response;

  try {
    response = await request.get(apiUrl.toString(), {
      headers: getCrmHeaders(apiKey),
      timeout,
    });
  } catch (error) {
    throw createCrmApiError(
      'CRM_API_ERROR',
      `CRM verification list request failed: ${error.message}`
    );
  }

  const responseText = await response.text().catch(() => '');

  if (!response.ok()) {
    throw createCrmApiError(
      'CRM_API_ERROR',
      `CRM verification list API returned ${response.status()} ` +
      `${response.statusText()}. ` +
      `Response: ${responseText.slice(0, 500)}`
    );
  }

  let responseData;

  try {
    responseData = JSON.parse(responseText);
  } catch (error) {
    throw createCrmApiError(
      'MISSING_DATA',
      `CRM verification list API returned invalid JSON: ` +
      `${error.message}. Response: ${responseText.slice(0, 500)}`
    );
  }

  const hasDataArray = Array.isArray(responseData?.data);
  const isSuccessfulResponse = responseData?.status === true;
  const isEmptyListResponse =
    responseData?.status === false &&
    hasDataArray &&
    responseData.data.length === 0;

  if (
    !responseData ||
    !hasDataArray ||
    (!isSuccessfulResponse && !isEmptyListResponse)
  ) {
    throw createCrmApiError(
      'MISSING_DATA',
      'CRM verification list API returned an invalid data structure.'
    );
  }

  return responseData;
}

async function updateTokenStatus(
  request,
  tokenId,
  options = {}
) {
  if (!request || typeof request.post !== 'function') {
    throw createCrmApiError(
      'MISSING_CONFIGURATION',
      'A Playwright API request context is required.'
    );
  }

  const normalizedTokenId = String(tokenId || '').trim();

  if (!normalizedTokenId) {
    throw createCrmApiError(
      'MISSING_DATA',
      'CRM token ID is missing.'
    );
  }

  const {
    apiKey,
    baseUrl,
    timeout,
  } = getCrmRequestConfig(options);
  const rdStatus = Number(options.rdStatus ?? 1);

  if (![0, 1].includes(rdStatus)) {
    throw createCrmApiError(
      'MISSING_CONFIGURATION',
      'CRM rdStatus must be either 0 (pending) or 1 (submitted).'
    );
  }

  const apiUrl = getCrmApiUrl(baseUrl, 'common.php');
  let response;

  try {
    response = await request.post(apiUrl, {
      headers: getCrmHeaders(apiKey),
      form: {
        verified_in_bank: 1,
        tokenid: normalizedTokenId,
        rd_status: rdStatus,
      },
      timeout,
    });
  } catch (error) {
    throw createCrmApiError(
      'STATUS_UPDATE_ERROR',
      `Status update request failed for token ` +
      `${normalizedTokenId}: ${error.message}`
    );
  }

  const responseText = await response.text().catch(() => '');

  if (!response.ok()) {
    throw createCrmApiError(
      'STATUS_UPDATE_ERROR',
      `Status update API returned ${response.status()} ` +
      `${response.statusText()} for token ${normalizedTokenId}. ` +
      `Response: ${responseText.slice(0, 500)}`
    );
  }

  let responseData;

  try {
    responseData = JSON.parse(responseText);
  } catch (error) {
    throw createCrmApiError(
      'STATUS_UPDATE_ERROR',
      `Status update API returned invalid JSON for token ` +
      `${normalizedTokenId}: ${error.message}. ` +
      `Response: ${responseText.slice(0, 500)}`
    );
  }

  if (
    responseData?.status === false ||
    responseData?.success === false
  ) {
    throw createCrmApiError(
      'STATUS_UPDATE_ERROR',
      `Status update API rejected token ${normalizedTokenId}. ` +
      `Response: ${JSON.stringify(responseData)}`
    );
  }

  return responseData;
}

module.exports = {
  fetchCrmCustomerDetails,
  fetchCrmVerificationList,
  getLastEightDaysDateRange,
  updateTokenStatus,
};
