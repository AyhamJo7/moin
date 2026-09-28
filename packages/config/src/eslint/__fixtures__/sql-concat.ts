// Violates: no-restricted-syntax (SQL built by string concatenation)
export function deleteTask(id: string): string {
  return 'DELETE FROM tasks WHERE id = ' + id;
}
