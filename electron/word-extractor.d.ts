/** word-extractor 没有自带类型声明：这里只声明我们用到的两个方法 */
declare module 'word-extractor' {
  interface WordDocument {
    getBody(): string
    getHeaders?(): string
    getFooters?(): string
    getFootnotes?(): string
    getEndnotes?(): string
  }
  export default class WordExtractor {
    extract(source: string | Buffer): Promise<WordDocument>
  }
}
