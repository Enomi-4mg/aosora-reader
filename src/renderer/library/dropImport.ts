/** ドロップされた File を、取り込み可能な実ファイルパスへ変換する。 */
export function importablePathsFromFiles(
  files: Iterable<File>,
  getPathForFile: (file: File) => string
): string[] {
  const paths: string[] = []
  for (const file of files) {
    const path = getPathForFile(file)
    if (/\.(txt|zip)$/i.test(path)) paths.push(path)
  }
  return paths
}
