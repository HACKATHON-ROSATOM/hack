<script setup>
const requests = [
  { id: 96, equipment: 'Генератор', due: '27.10.2026, 18:00', status: 'В работе' },
  { id: 95, equipment: 'Конвертер', due: '26.10.2026, 12:00', status: 'Ожидание ЗИП' },
]

const columns = [
  { accessorKey: 'id', header: '№ заявки' },
  { accessorKey: 'equipment', header: 'Оборудование' },
  { accessorKey: 'due', header: 'Плановый срок' },
  { accessorKey: 'status', header: 'Статус' },
  { id: 'actions', header: 'Действие' },
]

const filterOptions = [
  { label: 'В работе', value: 'in_progress' },
  { label: 'Ожидание ЗИП', value: 'waiting_parts' },
]
</script>

<template>
  <UCard class="bg-white ring-1 ring-brand/15">
    <h2 class="mb-4 text-lg font-semibold text-gray-900">Просроченные заявки</h2>
    <TableToolbar :filter-options="filterOptions" />
    <UTable :data="requests" :columns="columns">
      <template #actions-cell="{ row }">
        <UButton :to="'/requests/' + row.original.id" variant="outline">Открыть</UButton>
      </template>
    </UTable>
  </UCard>
</template>
