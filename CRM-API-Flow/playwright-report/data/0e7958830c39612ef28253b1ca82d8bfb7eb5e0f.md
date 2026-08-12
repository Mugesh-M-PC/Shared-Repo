# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: hdb\rvFlow.spec.js >> HDB RV Flow
- Location: tests\hdb\rvFlow.spec.js:447:1

# Error details

```
Error: CRM_API_KEY is not configured.
```

# Test source

```ts
  1   | function createCrmApiError(category, message) {
> 2   |   const error = new Error(message);
      |                 ^ Error: CRM_API_KEY is not configured.
  3   |   error.category = category;
  4   |   return error;
  5   | }
  6   | 
  7   | function getCrmApiUrl(baseUrl, endpoint) {
  8   |   const normalizedBaseUrl = String(baseUrl || '').trim();
  9   | 
  10  |   if (!normalizedBaseUrl) {
  11  |     throw createCrmApiError(
  12  |       'MISSING_CONFIGURATION',
  13  |       'CRM_BASE_URL is not configured.'
  14  |     );
  15  |   }
  16  | 
  17  |   try {
  18  |     const baseUrlWithSlash = normalizedBaseUrl.endsWith('/')
  19  |       ? normalizedBaseUrl
  20  |       : `${normalizedBaseUrl}/`;
  21  | 
  22  |     return new URL(endpoint, baseUrlWithSlash).toString();
  23  |   } catch (error) {
  24  |     throw createCrmApiError(
  25  |       'MISSING_CONFIGURATION',
  26  |       `CRM_BASE_URL is invalid: ${error.message}`
  27  |     );
  28  |   }
  29  | }
  30  | 
  31  | function getCustomerDetailsUrl(baseUrl, tokenId) {
  32  |   const normalizedTokenId = String(tokenId || '').trim();
  33  | 
  34  |   if (!normalizedTokenId) {
  35  |     throw createCrmApiError(
  36  |       'MISSING_DATA',
  37  |       'CRM token ID is missing.'
  38  |     );
  39  |   }
  40  | 
  41  |   const url = new URL(
  42  |     getCrmApiUrl(baseUrl, 'custdetails.php')
  43  |   );
  44  |   url.searchParams.set('tokenid', normalizedTokenId);
  45  | 
  46  |   return url.toString();
  47  | }
  48  | 
  49  | function getCrmRequestConfig(options = {}) {
  50  |   const baseUrl = options.baseUrl || process.env.CRM_BASE_URL;
  51  |   const apiKey = String(
  52  |     options.apiKey || process.env.CRM_API_KEY || ''
  53  |   ).trim();
  54  |   const timeout = Number(options.timeout ?? 30_000);
  55  | 
  56  |   if (!apiKey) {
  57  |     throw createCrmApiError(
  58  |       'MISSING_CONFIGURATION',
  59  |       'CRM_API_KEY is not configured.'
  60  |     );
  61  |   }
  62  | 
  63  |   if (!Number.isFinite(timeout) || timeout <= 0) {
  64  |     throw createCrmApiError(
  65  |       'MISSING_CONFIGURATION',
  66  |       'CRM API timeout must be a positive number.'
  67  |     );
  68  |   }
  69  | 
  70  |   return {
  71  |     apiKey,
  72  |     baseUrl,
  73  |     timeout,
  74  |   };
  75  | }
  76  | 
  77  | function getCrmHeaders(apiKey) {
  78  |   return {
  79  |     'X-API-Key': apiKey,
  80  |   };
  81  | }
  82  | 
  83  | function formatCrmDate(date) {
  84  |   const day = String(date.getDate()).padStart(2, '0');
  85  |   const month = String(date.getMonth() + 1).padStart(2, '0');
  86  |   const year = date.getFullYear();
  87  | 
  88  |   return `${day}-${month}-${year}`;
  89  | }
  90  | 
  91  | function normalizeCrmDate(value, fieldName) {
  92  |   const normalized = String(value || '').trim();
  93  |   const match = normalized.match(
  94  |     /^(\d{2})-(\d{2})-(\d{4})$/
  95  |   );
  96  | 
  97  |   if (!match) {
  98  |     throw createCrmApiError(
  99  |       'MISSING_CONFIGURATION',
  100 |       `${fieldName} must use dd-MM-yyyy format.`
  101 |     );
  102 |   }
```