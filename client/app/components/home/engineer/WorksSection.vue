<script setup>
const works = [
  { id: 101, equipment: 'Генератор', status: 'Новая', due: '28.10.2026, 18:00', action: 'Взять в работу' },
  { id: 97, equipment: 'Конвертер', status: 'Ожидание ЗИП', due: '30.10.2026, 12:00', action: 'Открыть' },
]

const columns = [
  { accessorKey: 'id', header: '№ заявки' },
  { accessorKey: 'equipment', header: 'Оборудование' },
  { accessorKey: 'status', header: 'Статус' },
  { accessorKey: 'due', header: 'Плановый срок' },
  { id: 'actions', header: 'Действие' },
]

const filterOptions = [
  { label: 'Новая', value: 'new' },
  { label: 'В работе', value: 'in_progress' },
  { label: 'Ожидание ЗИП', value: 'waiting_parts' },
]
</script>

<template>
  <UCard class="bg-white ring-1 ring-brand/15">
    <h2 class="mb-4 text-lg font-semibold text-gray-900">Мои работы</h2>
    <TableToolbar :filter-options="filterOptions" />
    <UTable :data="works" :columns="columns">
      <template #actions-cell="{ row }">
        <UButton :to="'/requests/' + row.original.id" variant="outline">
          {{ row.original.action }}
        </UButton>
      </template>
    </UTable>
  </UCard>
</template>
