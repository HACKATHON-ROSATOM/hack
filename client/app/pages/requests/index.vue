<script setup>
import { useUserStore } from '~/stores/user'
import RequestsTable from '~/components/requests/RequestsTable.vue'
import { typeLabels, statusLabels, priorityLabels, formatDate, loadEquipment } from '~/components/requests/requestUtils'
import { apiProblem } from '~/utils/apiProblem'

const userStore = useUserStore()
const search = ref('')
const kind = ref('all')
const status = ref('all')
const requests = ref([])
const equipment = ref([])
const engineers = ref([])
const loading = ref(true)
const error = ref('')
const kindOptions = [{ label: 'Все типы', value: 'all' }, ...Object.entries(typeLabels).map(([value, label]) => ({ value, label }))]
const statusOptions = [{ label: 'Все статусы', value: 'all' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [result, objects, people] = await Promise.all([
      userStore.api('/api/requests'), loadEquipment(userStore), userStore.api('/api/engineers'),
    ])
    requests.value = result.items
    equipment.value = objects
    engineers.value = people.items
  } catch (err) {
    error.value = apiProblem(err).detail
  } finally {
    loading.value = false
  }
}
onMounted(load)

const filteredRequests = computed(() => requests.value.map((request) => {
  const object = equipment.value.find((item) => item.id === request.equipmentId)
  const person = engineers.value.find((item) => item.id === request.assigneeId)
  return {
    ...request,
    kind: typeLabels[request.type] || request.type,
    equipment: object ? `${object.name}${object.externalId ? ` (${object.externalId})` : ''}` : request.equipmentId || (request.snapshot?.turbineNumber != null ? `ВЭУ №${request.snapshot.turbineNumber}` : request.telemetryTurbineId || 'Не указано'),
    assignee: person?.name || request.assigneeId,
    priorityLabel: priorityLabels[request.priority] || request.priority,
    statusLabel: statusLabels[request.status] || request.status,
    due: formatDate(request.currentDeadline),
  }
}).filter((request) => {
  const query = search.value.trim().toLowerCase()
  return [request.ticketNumber, request.id, request.equipment, request.assignee, request.description].join(' ').toLowerCase().includes(query)
    && (kind.value === 'all' || request.type === kind.value)
    && (status.value === 'all' || request.status === status.value)
}))

function csvCell(value) {
  let text = String(value ?? '')
  if (/^[\s\uFEFF]*[=+\-@\t\r\n]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

function exportRequests() {
  if (loading.value || error.value || !filteredRequests.value.length) return
  const rows = [
    ['Номер заявки', 'Тип', 'Объект', 'Приоритет', 'Срок', 'Исполнитель', 'Статус', 'Просрочена', 'Описание'],
    ...filteredRequests.value.map((request) => [
      request.ticketNumber, request.kind, request.equipment, request.priorityLabel, request.due,
      request.assignee || 'Не назначен', request.statusLabel, request.isOverdue ? 'Да' : 'Нет', request.description,
    ]),
  ]
  const csv = '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'requests.csv'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
</script>

<template>
  <main class="mx-auto max-w-6xl space-y-6 px-4 py-10">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold text-gray-900">Заявки</h1>
      <UButton color="neutral" variant="outline" :disabled="loading || !!error || !filteredRequests.length" @click="exportRequests">Экспорт CSV</UButton>
      <UButton v-if="userStore.role === 'dispatcher'" color="primary" to="/requests/new">Создать заявку</UButton>
    </div>
    <UCard class="bg-white ring-1 ring-brand/15">
      <div class="flex flex-wrap gap-3">
        <UInput v-model.trim="search" icon="i-lucide-search" placeholder="Поиск по заявкам" class="w-64" />
        <USelect v-model="kind" :items="kindOptions" value-key="value" class="w-44" />
        <USelect v-model="status" :items="statusOptions" value-key="value" class="w-44" />
      </div>
    </UCard>
    <UCard class="bg-white ring-1 ring-brand/15">
      <p v-if="loading" role="status">Загрузка заявок…</p>
      <div v-else-if="error" role="alert" class="space-y-3 text-red-700"><p>{{ error }}</p><UButton color="warning" @click="load">Повторить</UButton></div>
      <template v-else>
        <h2 class="mb-4 text-lg font-semibold text-gray-900">Все заявки</h2>
        <p v-if="!filteredRequests.length" class="text-gray-600">Заявки не найдены.</p>
        <RequestsTable v-else :requests="filteredRequests" />
      </template>
    </UCard>
  </main>
</template>
