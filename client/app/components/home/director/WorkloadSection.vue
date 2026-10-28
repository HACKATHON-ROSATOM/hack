<script setup>
const workload = [
  { employee: 'Иванов', requests: 3 },
  { employee: 'Петров', requests: 2 },
]

const columns = [
  { accessorKey: 'employee', header: 'Сотрудник' },
  { accessorKey: 'requests', header: 'Назначено заявок' },
]
</script>

<template>
  <UCard class="bg-white ring-1 ring-brand/15">
    <h2 class="mb-4 text-lg font-semibold text-gray-900">Назначенная нагрузка</h2>
    <TableToolbar />
    <UTable :data="workload" :columns="columns" />
  </UCard>
</template>

