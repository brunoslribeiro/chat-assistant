export const VALID_CANDIDATES = new Set([
  'COC::Financeiro', 'COC::Secretaria', 'COC::Comercial',
  'MARALTO::Financeiro', 'MARALTO::Secretaria', 'MARALTO::Comercial'
]);

export const SALESFORCE_QUEUE_BY_CANDIDATE = {
  'COC::Financeiro': 'Queue_Financeiro_COC',
  'COC::Secretaria': 'Queue_Secretaria_COC',
  'COC::Comercial': 'Queue_Comercial_COC',
  'MARALTO::Financeiro': 'Queue_Financeiro_Maralto',
  'MARALTO::Secretaria': 'Queue_Secretaria_Maralto',
  'MARALTO::Comercial': 'Queue_Comercial_Maralto'
};
