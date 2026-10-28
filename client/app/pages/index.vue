<script setup>
import { useUserStore } from '~/stores/user'
import { apiProblem } from '~/utils/apiProblem'
import StatCards from '~/components/home/StatCards.vue'

const userStore = useUserStore()
const requests = ref([])
const workload = ref([])
const engineers = ref([])
const loading = ref(true)
const error = ref('')
const roleTitle = computed(() => ({ dispatcher: 'Дежурный', engineer: 'Инженер', director: 'Технический директор' })[userStore.role] || 'Сводка')
const relevant = computed(() => userStore.role === 'engineer'
  ? requests.value.filter(item => item.assigneeId === userStore.user?.id)
  : requests.value)
const active = computed(() => relevant.value.filter(item => item.status !== 'COMPLETED'))
const overdue = computed(() => active.value.filter(item => item.isOverdue))
const unassigned = computed(() => active.value.filter(item => !item.assigneeId))
const stats = computed(() => [
  { label: 'Активные заявки', value: active.value.length },
  { label: 'Просроченные', value: overdue.value.length },
  { label: 'Завершённые', value: relevant.value.filter(item => item.status === 'COMPLETED').length },
  ...(userStore.role === 'engineer' ? [] : [{ label: 'Без исполнителя', value: unassigned.value.length }]),
])
const statusLabels = { NEW: 'Новая', IN_PROGRESS: 'В работе', WAITING_PARTS: 'Ожидание запчастей', COMPLETED: 'Завершена' }
const statusColors = { NEW: '#2563eb', IN_PROGRESS: '#7c3aed', WAITING_PARTS: '#d97706', COMPLETED: '#16a34a' }
const statusMetrics = computed(() => Object.entries(statusLabels).map(([status, label]) => ({
  status,
  label,
  count: relevant.value.filter(item => item.status === status).length,
  color: statusColors[status],
})))
const chartData = computed(() => statusMetrics.value.filter(item => item.count > 0))
const workloadRows = computed(() => engineers.value
  .filter(person => userStore.role !== 'engineer' || person.id === userStore.user?.id)
  .map(person => ({
    engineerId: person.id,
    name: person.name,
    activeTicketsCount: workload.value.find(item => item.engineerId === person.id)?.activeTicketsCount ?? 0,
  })))
const columns = [
  { accessorKey: 'ticketNumber', header: 'Заявка' },
  { accessorKey: 'description', header: 'Описание' },
  { accessorKey: 'status', header: 'Статус' },
  { accessorKey: 'currentDeadline', header: 'Срок' },
  { id: 'actions', header: 'Действие' },
]
const workloadColumns = [{ accessorKey: 'name', header: 'Инженер' }, { accessorKey: 'activeTicketsCount', header: 'Активных заявок' }]

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [tickets, loads, people] = await Promise.all([
      userStore.api('/api/requests'),
      userStore.api('/api/requests/analytics/workload'),
      userStore.api('/api/engineers'),
    ])
    requests.value = tickets.items
    workload.value = loads.items
    engineers.value = people.items
  } catch (err) {
    error.value = apiProblem(err).detail
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>
<template>
  <main class="mx-auto max-w-6xl space-y-6 px-4 py-10">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold text-gray-900">{{ roleTitle }}</h1>
      <div class="flex flex-wrap gap-2">
        <UButton v-if="userStore.role === 'dispatcher'" to="/requests/new">Создать заявку</UButton>
        <UButton to="/requests" variant="outline">Все заявки</UButton>
      </div>
    </div>
    <p v-if="loading" role="status" class="text-sm text-gray-600">Загрузка сводки…</p>
    <div v-else-if="error" role="alert" class="space-y-2 text-sm text-red-700"><p>{{ error }}</p><UButton variant="outline" @click="load">Повторить</UButton></div>
    <template v-else>
      <StatCards :stats="stats" />
      <UCard v-if="userStore.role === 'director'" class="bg-white ring-1 ring-brand/15">
        <h2 class="text-lg font-semibold text-gray-900">Заявки по статусам</h2>
        <p class="mt-1 text-sm text-gray-600">Текущее распределение всех заявок</p>
        <p v-if="!relevant.length" class="mt-4 text-sm text-gray-600">Заявок пока нет.</p>
        <div v-else class="mt-4 flex flex-wrap items-center gap-6">
          <UChart
            type="donut"
            :data="chartData"
            index="label"
            :categories="[{ key: 'count', label: 'Заявки' }]"
            :colors="chartData.map(item => item.color)"
            :legend="false"
            :height="220"
            aria-label="Распределение заявок по статусам"
            class="w-full max-w-64"
          />
          <ul class="min-w-48 flex-1 space-y-3">
            <li v-for="item in statusMetrics" :key="item.status" class="flex items-center gap-2 text-sm text-gray-900">
              <span aria-hidden="true" class="size-3 shrink-0 rounded-full" :style="{ backgroundColor: item.color }" />
              <span class="flex-1">{{ item.label }}</span>
              <span class="font-semibold tabular-nums">{{ item.count }}</span>
            </li>
          </ul>
        </div>
      </UCard>
      <UCard class="bg-white ring-1 ring-brand/15">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">{{ userStore.role === 'engineer' ? 'Мои активные заявки' : 'Активные заявки' }}</h2>
        <p v-if="!active.length" class="text-sm text-gray-600">Активных заявок нет.</p>
        <UTable v-else :data="active" :columns="columns">
          <template #ticketNumber-cell="{ row }">№{{ row.original.ticketNumber }}</template>
          <template #status-cell="{ row }">{{ statusLabels[row.original.status] || 'Неизвестно' }}<span v-if="row.original.isOverdue" class="ml-2 text-red-700">Просрочена</span></template>
          <template #currentDeadline-cell="{ row }">{{ row.original.currentDeadline ? new Date(row.original.currentDeadline).toLocaleString('ru-RU') : 'Неизвестно' }}</template>
          <template #actions-cell="{ row }"><UButton :to="`/requests/${row.original.id}`" variant="outline">Открыть</UButton></template>
        </UTable>
      </UCard>
      <UCard class="bg-white ring-1 ring-brand/15">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">{{ userStore.role === 'engineer' ? 'Моя нагрузка' : 'Нагрузка инженеров' }}</h2>
        <p v-if="!workloadRows.length" class="text-sm text-gray-600">Нет данных о нагрузке.</p>
        <UTable v-else :data="workloadRows" :columns="workloadColumns" />
      </UCard>
    </template>
  </main>
</template>
