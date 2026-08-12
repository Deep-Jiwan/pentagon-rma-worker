// Must stay in the exact same order as the header row created by
// setup_rma_tracker.gs — this is what maps sheet columns A..W to
// named fields on both read and write.
export const HEADERS = [
  'RMA ID',
  'SN',
  'Customer Name',
  'Mobile Number',
  'Invoice Number',
  'Purchase Date',
  'Model Number',
  'Product Type',
  'Brand',
  'Problem Description',
  'Technician Name',
  'Date In',
  'Warranty Status',
  'Status',
  'Resolution',
  'Repair/Replacement Details',
  'Date Out',
  'Collected By Name',
  'Collector Mobile Number',
  'Red Flag',
  'Red Flag Reason',
  'Additional Details',
  'Last Edited Timestamp'
];

export const LAST_COL = 'W'; // 23rd letter — last column, must match HEADERS.length
