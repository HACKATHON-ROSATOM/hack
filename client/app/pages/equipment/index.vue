<script setup>
import { useUserStore } from '~/stores/user'

const userStore = useUserStore()
const search = ref('')
const equipment = ref([])
const loading = ref(true)
const error = ref('')

const visibleEquipment = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return equipment.value.filter(item => [item.externalId, item.name, item.location, item.id]
    .some(value => String(value ?? '').toLocaleLowerCase().includes(query)))
})
const columns = [
  { accessorKey: 'externalId', header: 'ID' },
  { accessorKey: 'name', header: 'Оборудование' },
  { accessorKey: 'location', header: 'Расположение' },
  { id: 'actions', header: 'Действие' },
]

async function load() {
  loading.value = true
  error.value = ''
  try {
    await userStore.restore()
    const items = []
    let page = 1
    let total
    do {
      const result = await userStore.api('/api/equipment', { query: { page, pageSize: 100 } })
      items.push(...result.items)
      total = result.total
      if (!result.items.length) break
      page++
    } while (items.length < total)
    equipment.value = items
  } catch (err) {
    error.value = err.data?.detail || err.message || 'Не удалось загрузить оборудование.'
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<template>
  <main class="mx-auto max-w-6xl space-y-6 px-4 py-10">
    <h1 class="text-2xl font-semibold text-gray-900">Оборудование</h1>
    <UCard class="bg-white ring-1 ring-brand/15">
      <UInput v-model="search" icon="i-lucide-search" placeholder="Поиск по названию, ID или расположению" aria-label="Поиск оборудования" class="mb-4 w-72 max-w-full" />
      <p v-if="loading" role="status" class="text-sm text-gray-600">Загрузка оборудования…</p>
      <div v-else-if="error" role="alert" class="space-y-2 text-sm text-red-700">
        <p>{{ error }}</p><UButton variant="outline" @click="load">Повторить</UButton>
      </div>
      <p v-else-if="!visibleEquipment.length" class="text-sm text-gray-600">{{ equipment.length ? 'Ничего не найдено.' : 'Оборудование отсутствует.' }}</p>
      <UTable v-else :data="visibleEquipment" :columns="columns">
        <template #externalId-cell="{ row }">{{ row.original.externalId || 'Неизвестно' }}</template>
        <template #location-cell="{ row }">{{ row.original.location || 'Неизвестно' }}</template>
        <template #actions-cell="{ row }"><UButton :to="'/equipment/' + row.original.id" variant="outline">Открыть</UButton></template>
      </UTable>
    </UCard>
  </main>
</template>
