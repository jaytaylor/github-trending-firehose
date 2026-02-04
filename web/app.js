const snapshotForm = document.getElementById("snapshot-form")
const snapshotType = document.getElementById("snapshot-type")
const snapshotDate = document.getElementById("snapshot-date")
const snapshotLanguage = document.getElementById("snapshot-language")
const snapshotMeta = document.getElementById("snapshot-meta")

const searchForm = document.getElementById("search-form")
const searchType = document.getElementById("search-type")
const searchQuery = document.getElementById("search-query")
const searchStart = document.getElementById("search-start")
const searchEnd = document.getElementById("search-end")
const searchLanguage = document.getElementById("search-language")
const searchMeta = document.getElementById("search-meta")

const resultsBody = document.getElementById("results-body")
const resultsCount = document.getElementById("results-count")

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw new Error(payload.error || `Request failed: ${res.status}`)
  }
  return res.json()
}

function formatLanguageLabel(value) {
  if (value === "(null)") {
    return "All languages"
  }
  return value
}

function setResults(rows) {
  resultsCount.textContent = `${rows.length} rows`
  resultsBody.innerHTML = ""

  if (rows.length === 0) {
    const empty = document.createElement("div")
    empty.className = "empty"
    empty.textContent = "No results found."
    resultsBody.appendChild(empty)
    return
  }

  rows.forEach((row) => {
    const wrapper = document.createElement("div")
    wrapper.className = "result-row"

    const date = document.createElement("div")
    date.textContent = row.date

    const rank = document.createElement("div")
    rank.textContent = row.rank ? `#${row.rank}` : "-"

    const name = document.createElement("div")
    name.innerHTML = `<strong>${row.name}</strong> <span>${row.language ? row.language : "all"}</span>`

    wrapper.appendChild(date)
    wrapper.appendChild(rank)
    wrapper.appendChild(name)

    resultsBody.appendChild(wrapper)
  })
}

async function populateLatestDates() {
  const [repoLatest, devLatest] = await Promise.all([
    fetchJson(`/api/latest?type=repository`),
    fetchJson(`/api/latest?type=developer`),
  ])

  if (repoLatest.date) {
    snapshotDate.value = repoLatest.date
    searchEnd.value = repoLatest.date
  }

  if (repoLatest.date && !searchStart.value) {
    const end = new Date(repoLatest.date)
    const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000)
    searchStart.value = start.toISOString().slice(0, 10)
  }

  if (snapshotType.value === "developer" && devLatest.date) {
    snapshotDate.value = devLatest.date
  }
}

async function populateLanguages() {
  if (!snapshotDate.value) {
    return
  }

  const data = await fetchJson(`/api/languages?type=${snapshotType.value}&date=${snapshotDate.value}`)
  snapshotLanguage.innerHTML = ""

  data.languages.forEach((lang) => {
    const option = document.createElement("option")
    option.value = lang
    option.textContent = formatLanguageLabel(lang)
    snapshotLanguage.appendChild(option)
  })

  if (!data.languages.includes("(null)")) {
    const option = document.createElement("option")
    option.value = "(null)"
    option.textContent = "All languages"
    snapshotLanguage.appendChild(option)
  }

  snapshotLanguage.value = "(null)"
}

snapshotType.addEventListener("change", async () => {
  await populateLatestDates()
  await populateLanguages()
})

snapshotDate.addEventListener("change", async () => {
  await populateLanguages()
})

snapshotForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  snapshotMeta.textContent = "Loading snapshot..."
  try {
    const data = await fetchJson(
      `/api/snapshot?type=${snapshotType.value}&date=${snapshotDate.value}&language=${snapshotLanguage.value}`
    )

    const rows = data.list.map((name, idx) => ({
      date: data.date,
      language: data.language,
      rank: idx + 1,
      name,
    }))

    setResults(rows)
    snapshotMeta.textContent = `${rows.length} entries loaded for ${snapshotDate.value}.`
  } catch (error) {
    snapshotMeta.textContent = error.message
  }
})

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  searchMeta.textContent = "Searching..."

  const language = searchLanguage.value.trim() || "(null)"

  try {
    const data = await fetchJson(
      `/api/search?type=${searchType.value}&query=${encodeURIComponent(searchQuery.value)}&start=${searchStart.value}&end=${searchEnd.value}&language=${encodeURIComponent(language)}`
    )

    setResults(data.results)
    searchMeta.textContent = `${data.count} matches.`
  } catch (error) {
    searchMeta.textContent = error.message
  }
})

async function init() {
  await populateLatestDates()
  await populateLanguages()
  searchLanguage.value = "(null)"
}

init().catch((error) => {
  snapshotMeta.textContent = error.message
})
