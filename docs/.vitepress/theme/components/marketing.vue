<script setup lang="ts">
interface Feature {
	title: string
	description: string
	url?: string
	icon: string
}

const features: Feature[] = [
	{
		title: 'App Launcher',
		description: 'Search, drag-and-drop reorder, and launch containers from a beautiful grid with live status badges.',
		url: '/guide/app-launcher',
		icon: '/icons/mermaid.png',
	},
	{
		title: 'Recommended Catalog',
		description: '26+ curated self-hosted apps with one-click install, pre-filled env vars, and volumes.',
		url: '/guide/catalog',
		icon: '/icons/shell.png',
	},
	{
		title: 'Docker Lifecycle',
		description: 'Launch, stop, and restart containers with live log streaming, health badges, and CPU/MEM metrics.',
		url: '/guide/docker-lifecycle',
		icon: '/icons/snail.png',
	},
	{
		title: 'Compose Import',
		description: 'Import existing Docker Compose YAML files — one app per service, automatically configured.',
		url: '/guide/compose-import',
		icon: '/icons/starfish.png',
	},
	{
		title: 'Desktop Shortcuts',
		description: 'Auto-generates .app bundles on your Desktop for any container. Launch like a native app.',
		url: '/guide/web-ui',
		icon: '/icons/turtle.png',
	},
	{
		title: 'System Tray',
		description: 'Per-app live status dots, click-to-launch, and global Stop All / Restart All controls.',
		url: '/guide/system-tray',
		icon: '/icons/sun.png',
	},
]
</script>

<template>
	<client-only>
		<section class="relative flex flex-col mx-auto mt-20 lg:mt-40 md:px-10 xl:px-0 max-w-5xl size-full marketing">
			<!-- Hero -->
			<div class="flex lg:flex-row flex-col justify-between items-center lg:items-start gap-x-40 px-6 lg:px-0 w-full">
				<!-- Left block -->
				<section class="group max-w-2xl *:transition *:duration-500 *:ease-in-out grow">
					<!-- Title -->
					<h1 class="bg-clip-text font-title font-medium text-transparent text-6xl md:text-8xl lg:text-9xl lg:text-left text-center uppercase title title-bg leading-[0.9]">
						Container Cove
					</h1>
					<!-- Subtitle -->
					<p class="mt-4 font-mono font-medium text-xl lg:text-2xl lg:text-left text-center">
						Docker containers as desktop apps.
					</p>
					<!-- Description -->
					<p class="opacity-60 mt-4 font-medium text-lg lg:text-xl lg:text-left text-center">
						Run self-hosted services like native applications. No terminal, no commands, no friction. Built with Electrobun.
					</p>
					<!-- Actions -->
					<div class="flex flex-wrap justify-center lg:justify-start gap-4 mt-10">
						<a
							class="group flex items-center bg-teal-100 hover:bg-teal-200 dark:bg-teal-500/20 dark:hover:bg-teal-500/30 px-4.5 py-2.5 rounded-2xl font-semibold text-teal-800 hover:text-teal-900 dark:hover:text-teal-100 dark:text-teal-300 transition"
							href="/guide/"
						>
							Get started
							<svg
								class="ml-2 transition group-hover:translate-x-1"
								xmlns="http://www.w3.org/2000/svg"
								width="10"
								height="10"
								viewBox="0 0 24 24"
							>
								<path
									d="M13.025 1l-2.847 2.828 6.176 6.176h-16.354v3.992h16.354l-6.176 6.176 2.847 2.828 10.975-11z"
									fill="currentcolor"
								/>
							</svg>
						</a>
						<a
							class="group flex items-center bg-[var(--vp-c-bg-soft)] hover:bg-[var(--vp-c-bg-mute)] px-4.5 py-2 rounded-2xl font-medium text-[var(--vp-c-text-1)] transition"
							href="https://github.com/azevedomedia0/Container-Cove"
						>See on GitHub</a>
					</div>
				</section>

				<!-- Logo block -->
				<div class="group relative flex justify-center items-center order-first lg:order-last lg:mt-20 lg:mr-20 mb-20 w-30 lg:w-55 h-30 lg:h-55 hover:scale-105 transition duration-300 shrink-0">
					<img class="z-1 absolute size-full group-hover:scale-85 transition duration-300 rounded-2xl" src="/logo.png" alt="Container Cove" />
					<div class="absolute -inset-5 opacity-40 dark:opacity-70 rotate-45 image-bg" />
				</div>
			</div>

			<!-- Features -->
			<section class="gap-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-24 px-8 lg:px-0">
				<template v-for="feature in features" :key="feature.title">
					<component
						:is="feature.url ? 'a' : 'div'"
						class="group relative flex flex-col justify-center gap-4 bg-[var(--ui-bg-elevated)] p-6 rounded-lg ring-1 ring-[var(--ui-border)]"
						:class="{ 'cursor-pointer': feature.url }"
						:href="feature.url"
					>
						<div class="top-2 right-2 absolute flex justify-center items-center w-14 h-14 shrink-0">
							<img
								:src="feature.icon"
								alt=""
								class="opacity-40 dark:opacity-30 group-hover:opacity-100 size-full object-contain transition duration-300"
							/>
						</div>
						<div>
							<span
								class="inline-block text-[var(--ui-text-muted)] group-hover:text-[var(--ui-text)] transition font-mono uppercase font-medium tracking-wide"
								v-text="feature.title"
							/>
							<p
								class="mt-2 font-medium text-[var(--ui-text-dimmed)] group-hover:text-[var(--ui-text-highlighted)] text-sm leading-relaxed transition"
								v-html="feature.description"
							/>
						</div>
					</component>
				</template>
			</section>
		</section>
	</client-only>
</template>
