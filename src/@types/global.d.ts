declare module 'google-search-results-nodejs';
interface ResultSuccess {
  success: true;
  license: string;
  carMake: string;
  roadTaxExpiry?: string;
  lastUpdated?: string;
}

interface ResultFailed {
  success: false;
  message?: string;
  license?: string;
}

type ScrapeResult = ResultSuccess | ResultFailed;
