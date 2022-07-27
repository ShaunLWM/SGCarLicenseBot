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
}

type ScrapeResult = ResultSuccess | ResultFailed;
