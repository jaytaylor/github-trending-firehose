import fs from "fs/promises"
import path from "path"
import http from "http"
import https from "https"
import puppeteer from "puppeteer"
import Bottleneck from "bottleneck"
import {RepositoryLanguage, TrendingRepositoryPage} from "./scraper/TrendingRepositoryPage"
import {DeveloperLanguage, TrendingDeveloperPage} from './scraper/TrendingDeveloperPage'

const CONCURRENCY = 10
const ALLOW_LANGUAGES = [
    // Programming language
    "C",
    "C#",
    "C++",
    "Dart",
    "Elixir",
    "Erlang",
    "Go",
    "Haskell",
    "Java",
    "JavaScript",
    "Kotlin",
    "Lua",
    "Perl",
    "PHP",
    "Python",
    "R",
    "Ruby",
    "Rust",
    "Scala",
    "Shell",
    "Swift",
    "TypeScript",
    // Markup language
    "CSS",
    "HTML",
    "Markdown",
    // Frontend framework
    "Svelte",
    "Vue",
    // etc
    "HCL",
    "Makefile",
    "Lua",
    "WebAssembly",
]

type ScrapeType = "developer" | "repository"

type ImportOptions = {
    overwrite: boolean
    skipExisting: boolean
    dryRun: boolean
}

type ParsedArgs = {
    positionals: string[]
    flags: Set<string>
}

async function main() {
    const command = process.argv[2]
    const args = process.argv.slice(3)

    switch (command) {
        case "scrape":
            await runScrape(args)
            break
        case "import":
            await runImport(args)
            break
        default:
            failUsage("Unsupported command")
    }
}

async function runScrape(args: string[]) {
    const archiveType = args[0] as ScrapeType | undefined
    const archiveDirPath = args[1]

    if (!archiveType || !archiveDirPath) {
        failUsage("Missing scrape arguments")
    }

    switch (archiveType) {
        case "developer":
            await processDeveloperArchive(archiveDirPath)
            break
        case "repository":
            await processRepositoryArchive(archiveDirPath)
            break
        default:
            failUsage("Unsupported scrape type")
    }
}

async function runImport(args: string[]) {
    const dataset = args[0]

    if (!dataset) {
        failUsage("Missing import dataset")
    }

    switch (dataset) {
        case "hf-projects":
            await runHfProjectsImport(args.slice(1))
            break
        default:
            failUsage("Unsupported import dataset")
    }
}

async function runHfProjectsImport(args: string[]) {
    const parsed = parseArgs(args)
    const source = parsed.positionals[0]
    const archiveRoot = parsed.positionals[1]

    if (!source || !archiveRoot) {
        failUsage("Missing import arguments")
    }

    const overwrite = parsed.flags.has("overwrite")
    const skipExisting = parsed.flags.has("skip-existing") || !overwrite
    const dryRun = parsed.flags.has("dry-run")

    if (overwrite && parsed.flags.has("skip-existing")) {
        failUsage("Cannot use both --overwrite and --skip-existing")
    }

    const options: ImportOptions = {
        overwrite,
        skipExisting,
        dryRun,
    }

    const result = await importHfProjects(source, archiveRoot, options)
    console.log(
        `Import summary: rows=${result.rows} dates=${result.dates} written=${result.written} skipped=${result.skipped} invalid=${result.invalid}`,
    )
}

function parseArgs(args: string[]): ParsedArgs {
    const positionals: string[] = []
    const flags = new Set<string>()

    for (const arg of args) {
        if (arg.startsWith("--")) {
            const name = arg.slice(2).split("=")[0]
            if (name.length > 0) {
                flags.add(name)
            }
        } else {
            positionals.push(arg)
        }
    }

    return {positionals, flags}
}

function failUsage(message: string): never {
    console.error(message)
    printUsage()
    process.exit(1)
}

function printUsage() {
    console.error(
        [
            "Usage:",
            "  npm run start scrape <developer|repository> <archive-dir>",
            "  npm run start import hf-projects <csv-path-or-url> <archive-root> [--skip-existing] [--overwrite] [--dry-run]",
        ].join("\n"),
    )
}

async function processDeveloperArchive(archiveDirPath: string) {
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    try {
        const limiter = new Bottleneck({
            maxConcurrent: CONCURRENCY,
        })
        const entry = await TrendingDeveloperPage.from(await browser.newPage())
        const languages = await entry.getDeveloperLanguageList()
        const allLanguagesResult = {
            language: '',
            items: await entry.getDeveloperList().finally(() => entry.close()),
        }
        const resultList = await Promise.all(
            languages
                .filter((language: DeveloperLanguage) => ALLOW_LANGUAGES.includes(language.label))
                .map((language: DeveloperLanguage) => {
                    return limiter.schedule(async () => {
                        const page = await browser.newPage()
                        const fetcher = await TrendingDeveloperPage.from(page, language.url)
                        return {
                            language: language.slug,
                            items: await fetcher.getDeveloperList().finally(() => fetcher.close()),
                        }
                    })
                }),
        )
        resultList.push(allLanguagesResult)
        await persistDeveloper(resultList, archiveDirPath)
    } finally {
        await browser.close()
    }
}

async function persistDeveloper(
    resultList: {
        language: string
        items: Record<string, any>[]
    }[],
    dir: string,
) {
    await fs.mkdir(dir, {recursive: true})
    return Promise.all(
        resultList.map(async (result) => {
            const language = (result.language !== '')
                ? decodeURIComponent(result.language)
                : null
            const fileName = language ?? '(null)'
            const filePath = path.join(dir, `${fileName}.json`)
            const dataToWrite = {
                date: getToday(),
                language: language,
                list: uniqueList(result.items.map(developer => developer.username)),
            }
            await fs.writeFile(filePath, JSON.stringify(dataToWrite), "utf-8")
            console.log(`${fileName} — ${result.items.length} items`)
        }),
    )
}

async function processRepositoryArchive(archiveDirPath: string) {
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    try {
        const limiter = new Bottleneck({
            maxConcurrent: CONCURRENCY,
        })
        const entry = await TrendingRepositoryPage.from(await browser.newPage())
        const repositoryLanguageList = await entry.getRepositoryLanguageList()
        const allLanguagesResult = {
            language: '',
            items: await entry.getRepositoryList().finally(() => entry.close()),
        }
        const resultList = await Promise.all(
            repositoryLanguageList
                .filter((language: RepositoryLanguage) => ALLOW_LANGUAGES.includes(language.label))
                .map((language: RepositoryLanguage) => {
                    return limiter.schedule(async () => {
                        const page = await browser.newPage()
                        const fetcher = await TrendingRepositoryPage.from(page, language.url)
                        return {
                            language: language.slug,
                            items: await fetcher.getRepositoryList().finally(() => fetcher.close()),
                        }
                    })
                }),
        )
        resultList.push(allLanguagesResult)
        await persistRepository(resultList, archiveDirPath)
    } finally {
        await browser.close()
    }
}

async function persistRepository(
    resultList: {
        language: string
        items: Record<string, any>[]
    }[],
    dir: string,
) {
    await fs.mkdir(dir, {recursive: true})
    return Promise.all(
        resultList.map(async (result) => {
            const language = (result.language !== '')
                ? decodeURIComponent(result.language)
                : null
            const fileName = language ?? '(null)'
            const filePath = path.join(dir, `${fileName}.json`)
            const dataToWrite = {
                date: getToday(),
                language: language,
                list: uniqueList(result.items.map(repository => repository.fullName)),
            }
            await fs.writeFile(filePath, JSON.stringify(dataToWrite), "utf-8")
            console.log(`${fileName} — ${result.items.length} items`)
        }),
    )
}

type HfEntry = {
    rank: number
    fullName: string
}

type ImportResult = {
    rows: number
    dates: number
    written: number
    skipped: number
    invalid: number
}

async function importHfProjects(source: string, archiveRoot: string, options: ImportOptions): Promise<ImportResult> {
    const csv = await readSource(source)
    const lines = csv.split(/\r?\n/)

    if (lines.length < 2) {
        throw new Error("CSV source is empty")
    }

    const header = parseCsvLine(lines[0].trim())
    const headerIndex = new Map(header.map((name, index) => [name.trim(), index]))
    const requiredColumns = ["name", "repo_owner", "rank", "date"]

    for (const column of requiredColumns) {
        if (!headerIndex.has(column)) {
            throw new Error(`Missing required column: ${column}`)
        }
    }

    const nameIndex = headerIndex.get("name") as number
    const ownerIndex = headerIndex.get("repo_owner") as number
    const rankIndex = headerIndex.get("rank") as number
    const dateIndex = headerIndex.get("date") as number

    const entriesByDate = new Map<string, HfEntry[]>()
    let rows = 0
    let invalid = 0

    for (let i = 1; i < lines.length; i += 1) {
        const line = lines[i]
        if (!line || line.trim() === "") {
            continue
        }

        const fields = parseCsvLine(line)
        if (fields.length < header.length) {
            invalid += 1
            continue
        }

        const date = fields[dateIndex]?.trim()
        const rankValue = fields[rankIndex]?.trim()
        const owner = fields[ownerIndex]?.trim()
        const name = fields[nameIndex]?.trim()

        if (!date || !owner || !name || !rankValue) {
            invalid += 1
            continue
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            invalid += 1
            continue
        }

        const rank = Number.parseInt(rankValue, 10)
        if (!Number.isFinite(rank)) {
            invalid += 1
            continue
        }

        const fullName = `${owner}/${name}`
        const entries = entriesByDate.get(date) ?? []
        entries.push({rank, fullName})
        entriesByDate.set(date, entries)
        rows += 1
    }

    let written = 0
    let skipped = 0

    for (const [date, entries] of entriesByDate.entries()) {
        const year = date.slice(0, 4)
        const dir = path.join(archiveRoot, year, date)
        const filePath = path.join(dir, "(null).json")

        if (!options.overwrite && options.skipExisting) {
            const exists = await pathExists(filePath)
            if (exists) {
                skipped += 1
                continue
            }
        }

        const list = buildRankedList(entries)
        const payload = {
            date,
            language: null,
            list,
        }

        if (!options.dryRun) {
            await fs.mkdir(dir, {recursive: true})
            await fs.writeFile(filePath, JSON.stringify(payload), "utf-8")
        }
        written += 1
    }

    return {
        rows,
        dates: entriesByDate.size,
        written,
        skipped,
        invalid,
    }
}

function buildRankedList(entries: HfEntry[]): string[] {
    const ordered = [...entries].sort((a, b) => a.rank - b.rank)
    const seen = new Set<string>()
    const list: string[] = []

    for (const entry of ordered) {
        if (seen.has(entry.fullName)) {
            continue
        }
        seen.add(entry.fullName)
        list.push(entry.fullName)
    }

    return list
}

function parseCsvLine(line: string): string[] {
    const fields: string[] = []
    let field = ""
    let inQuotes = false

    for (let i = 0; i < line.length; i += 1) {
        const char = line[i]

        if (inQuotes) {
            if (char === '"') {
                const nextChar = line[i + 1]
                if (nextChar === '"') {
                    field += '"'
                    i += 1
                } else {
                    inQuotes = false
                }
            } else {
                field += char
            }
        } else if (char === ',') {
            fields.push(field)
            field = ""
        } else if (char === '"') {
            inQuotes = true
        } else {
            field += char
        }
    }

    fields.push(field)
    return fields
}

async function readSource(source: string): Promise<string> {
    if (source.startsWith("http://") || source.startsWith("https://")) {
        return fetchText(source)
    }

    return fs.readFile(source, "utf-8")
}

async function fetchText(url: string, redirects = 0): Promise<string> {
    if (redirects > 5) {
        throw new Error("Too many redirects")
    }

    const client = url.startsWith("https://") ? https : http

    return new Promise((resolve, reject) => {
        const request = client.get(url, (response) => {
            const statusCode = response.statusCode ?? 0

            if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
                response.resume()
                const nextUrl = new URL(response.headers.location, url).toString()
                fetchText(nextUrl, redirects + 1).then(resolve).catch(reject)
                return
            }

            if (statusCode !== 200) {
                response.resume()
                reject(new Error(`Request failed with status ${statusCode}`))
                return
            }

            const chunks: Buffer[] = []
            response.on("data", (chunk) => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
            })
            response.on("end", () => {
                resolve(Buffer.concat(chunks).toString("utf-8"))
            })
        })

        request.on("error", (error) => {
            reject(error)
        })
    })
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath)
        return true
    } catch {
        return false
    }
}

function getToday() {
    const now = new Date()
    return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
        .map((n) => String(n).padStart(2, "0"))
        .join("-")
}

function uniqueList(list: string[]): string[] {
    const seen = new Set<string>()
    const result: string[] = []

    for (const item of list) {
        if (seen.has(item)) {
            continue
        }
        seen.add(item)
        result.push(item)
    }

    return result
}

main().catch((e) => {
    console.error(e.stack)
    process.exit(1)
})
