export interface DatabaseRecordInput {
  label: string;
  value: string;
}

export interface DatabaseRecord extends DatabaseRecordInput {
  id: string;
}

// Integration points for the authenticated backend API. Null means disconnected.
// Use these DTOs only for non-sensitive fields. The password vault is separate.
export async function fetchDatabaseRecords(): Promise<DatabaseRecord[] | null> {
  return null;
}

export async function addDatabaseRecord(_record: DatabaseRecordInput): Promise<DatabaseRecord | null> {
  return null;
}
