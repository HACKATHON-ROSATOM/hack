<script setup>
import { useUserStore } from '~/stores/user'

const userStore = useUserStore()
const snapshot = ref(null)
const loading = ref(true)
const error = ref('')
const history = ref([])
const historyLoading = ref(false)
const historyError = ref('')
const selectedTurbine = ref('')
const selectedIoa = ref('')
const showRawHistory = ref(false)
const elapsed = ref(0)
const statusLabels = { 1: 'Остановлено', 3: 'Готов к запуску', 4: 'Работа', 8: 'Авария' }
let stopped = false
let timer
let clock
let snapshotStarted = 0
let snapshotController
let historyController

const connected = computed(() => !!snapshot.value?.connected && !error.value)
const turbine = computed(() => snapshot.value?.turbines.find(item => item.id === selectedTurbine.value))
const selectedSignal = computed(() => turbine.value?.signals.find(signal => String(signal.ioa) === selectedIoa.value))
const canSmooth = computed(() => selectedSignal.value && !['status', 'windDirection'].includes(selectedSignal.value.key))
const smoothing = computed(() => canSmooth.value && !showRawHistory.value)
const chartData = computed(() => {
  const observations = history.value
  if (!smoothing.value) {
    return observations.map(item => ({ time: formatTime(item.receivedAt), value: item.value }))
  }
  const points = []
  for (let start = 0; start < observations.length; start += 10) {
    const group = observations.slice(start, start + 10)
    points.push({
      time: formatTime(group[group.length - 1].receivedAt),
      value: group.reduce((sum, item) => sum + item.value, 0) / group.length,
    })
  }
  return points
})

function formatTime(value) {
  if (!value) return 'Нет данных'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Неизвестно' : date.toLocaleString('ru-RU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, timeZoneName: 'short' })
}

function isFresh(signal) {
  return connected.value && signal.fresh && elapsed.value <= signal.freshForMs
}

function valueText(signal) {
  if (signal.value === null) return 'Нет данных'
  if (signal.key === 'status') return `${statusLabels[signal.value] || 'Неизвестный статус'} (${signal.value})`
  return String(signal.value).replace('.', ',')
}

async function loadHistory(ioa, initial = false) {
  historyController?.abort()
  if (!ioa || stopped) return
  const controller = new AbortController()
  historyController = controller
  if (initial) {
    history.value = []
    historyLoading.value = true
  }
  try {
    const result = await userStore.api('/api/monitoring/history', { query: { ioa }, signal: controller.signal })
    if (!stopped && historyController === controller) {
      history.value = result.items
      historyError.value = ''
    }
  } catch (err) {
    if (!stopped && !controller.signal.aborted && historyController === controller) historyError.value = 'Не удалось загрузить историю. Повторим автоматически.'
  } finally {
    if (!stopped && historyController === controller) historyLoading.value = false
  }
}

async function refresh() {
  clearTimeout(timer)
  snapshotController?.abort()
  const controller = new AbortController()
  snapshotController = controller
  const started = performance.now()
  try {
    const result = await userStore.api('/api/monitoring', { signal: controller.signal })
    if (stopped || snapshotController !== controller) return
    snapshotStarted = started
    elapsed.value = performance.now() - started
    snapshot.value = result
    error.value = ''
    if (!result.turbines.some(item => item.id === selectedTurbine.value)) selectedTurbine.value = result.turbines[0]?.id || ''
  } catch (err) {
    if (!stopped && !controller.signal.aborted && snapshotController === controller) error.value = 'Не удалось получить данные мониторинга. Повторим автоматически.'
  } finally {
    if (!stopped && snapshotController === controller) {
      loading.value = false
      if (selectedIoa.value) loadHistory(selectedIoa.value)
      timer = setTimeout(refresh, 2000)
    }
  }
}

watch(turbine, current => {
  if (!current?.signals.some(signal => String(signal.ioa) === selectedIoa.value)) {
    selectedIoa.value = String(current?.signals.find(signal => signal.key === 'activePower')?.ioa ?? current?.signals[0]?.ioa ?? '')
  }
})
watch(selectedIoa, ioa => {
  historyController?.abort()
  history.value = []
  historyError.value = ''
  historyLoading.value = false
  if (ioa) loadHistory(ioa, true)
})

onMounted(() => {
  refresh()
  clock = setInterval(() => { elapsed.value = performance.now() - snapshotStarted }, 1000)
})
onBeforeUnmount(() => {
  stopped = true
  clearTimeout(timer)
  clearInterval(clock)
  snapshotController?.abort()
  historyController?.abort()
})
</script>

<template>
  <main class="mx-auto max-w-6xl space-y-6 px-4 py-10">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold text-gray-900">Мониторинг ВЭУ</h1>
        <p class="mt-1 text-sm text-gray-600">Последние показания ветроустановок</p>
      </div>
      <div v-if="!loading" class="flex items-center gap-2 text-sm font-medium" :class="connected ? 'text-green-700' : 'text-red-700'" role="status">
        <span aria-hidden="true" class="size-2 rounded-full" :class="connected ? 'bg-green-600' : 'bg-red-600'" />
        {{ error ? 'Нет связи с приложением' : connected ? 'Связь со стендом установлена' : 'Нет связи со стендом' }}
      </div>
    </div>

    <p v-if="loading" role="status" class="text-sm text-gray-600">Загрузка мониторинга…</p>
    <div v-else-if="error && !snapshot" role="alert" class="space-y-3 text-sm text-red-700">
      <p>{{ error }}</p>
      <UButton variant="outline" @click="refresh">Повторить</UButton>
    </div>
    <template v-else>
      <p v-if="error || !connected" role="status" class="text-sm text-gray-600">Показаны последние полученные данные.</p>
      <p v-if="!snapshot?.turbines.length" class="text-sm text-gray-600">Данные о ВЭУ пока не поступили.</p>
      <template v-else>
        <section aria-labelledby="turbines-heading" class="space-y-3">
          <h2 id="turbines-heading" class="text-lg font-semibold text-gray-900">Ветроустановки</h2>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <button
              v-for="item in snapshot.turbines" :key="item.id" type="button"
              class="rounded-lg border bg-white p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              :class="selectedTurbine === item.id ? 'border-brand ring-1 ring-brand' : 'border-gray-200 hover:border-gray-400'"
              :aria-pressed="selectedTurbine === item.id" @click="selectedTurbine = item.id"
            >
              <span class="block font-semibold text-gray-900">ВЭУ {{ item.number }}</span>
              <template v-if="item.signals.find(signal => signal.key === 'status')">
                <span class="mt-2 block text-sm text-gray-900">{{ valueText(item.signals.find(signal => signal.key === 'status')) }}</span>
                <span v-if="connected && !isFresh(item.signals.find(signal => signal.key === 'status')) && item.signals.find(signal => signal.key === 'status').receivedAt" class="mt-1 block text-xs text-amber-700">Нет новых данных с {{ formatTime(item.signals.find(signal => signal.key === 'status').receivedAt) }}</span>
              </template>
              <span v-else class="mt-2 block text-sm text-gray-600">Статус не получен</span>
            </button>
          </div>
        </section>

        <section v-if="turbine" aria-labelledby="signals-heading">
          <UCard class="bg-white ring-1 ring-brand/15">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="signals-heading" class="text-lg font-semibold text-gray-900">ВЭУ {{ turbine.number }} · показания</h2>
              <p class="text-sm text-gray-600">Время приёма</p>
            </div>
            <p v-if="!turbine.signals.length" class="mt-4 text-sm text-gray-600">Показания пока не поступили.</p>
            <dl v-else class="mt-4 divide-y divide-gray-200">
              <div v-for="signal in turbine.signals" :key="signal.ioa" class="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)] sm:gap-4">
                <dt class="text-sm text-gray-600">{{ signal.label }} <span class="text-xs">· IOA {{ signal.ioa }}</span></dt>
                <dd class="font-medium tabular-nums text-gray-900">{{ valueText(signal) }}<span v-if="signal.value !== null && signal.unit" class="ml-1 text-sm font-normal text-gray-600">{{ signal.unit }}</span></dd>
                <dd class="text-sm text-gray-600"><span v-if="connected && signal.receivedAt && !isFresh(signal)" class="text-amber-700">Нет новых данных с </span><span v-if="signal.receivedAt">{{ formatTime(signal.receivedAt) }}</span><span v-else>Нет данных</span></dd>
              </div>
            </dl>
          </UCard>
        </section>

        <section v-if="turbine?.signals.length" aria-labelledby="history-heading">
          <UCard class="bg-white ring-1 ring-brand/15">
            <div class="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 id="history-heading" class="text-lg font-semibold text-gray-900">История показаний</h2>
                <p class="mt-1 text-sm text-gray-600">ВЭУ {{ turbine.number }}</p>
              </div>
              <label class="space-y-1 text-sm text-gray-600">
                <span class="block">Параметр</span>
                <select v-model="selectedIoa" class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus-visible:outline-2 focus-visible:outline-brand sm:w-64">
                  <option v-for="signal in turbine.signals" :key="signal.ioa" :value="String(signal.ioa)">{{ signal.label }}{{ signal.unit ? `, ${signal.unit}` : '' }}</option>
                </select>
              </label>
            </div>
            <label v-if="canSmooth" class="mt-4 inline-flex items-center gap-2 text-sm text-gray-700">
              <input v-model="showRawHistory" type="checkbox" class="size-4 accent-brand">
              Показать исходные показания
            </label>
            <p v-if="historyLoading" role="status" class="mt-5 text-sm text-gray-600">Загрузка истории…</p>
            <p v-else-if="historyError" role="alert" class="mt-5 text-sm text-red-700">{{ historyError }}</p>
            <p v-else-if="!history.length" class="mt-5 text-sm text-gray-600">Для этого параметра ещё нет принятых наблюдений.</p>
            <div v-else class="mt-5">
              <UChart type="line" :curve="smoothing ? 'monotone' : 'linear'" :data="chartData" index="time" :categories="[{ key: 'value', label: selectedSignal?.label || 'Значение' }]" :colors="['#2563eb']" :height="260" :points="false" :legend="false" :aria-label="`История: ${selectedSignal?.label || 'показания'}`" />
              <p v-if="smoothing" class="mt-2 text-sm text-gray-600">Среднее до 10 показаний. Краткие пики могут быть скрыты.</p>
              <p class="mt-1 text-sm text-gray-600">Время приёма последнего показания в точке.</p>
            </div>
          </UCard>
        </section>
      </template>
    </template>
  </main>
</template>
