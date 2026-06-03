import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitepress'

const title = 'Container Cove'
const description = 'Run Docker containers as desktop apps — no terminal needed.'
const url = 'https://azevedomedia0.github.io/Container-Cove'
const github = 'https://github.com/azevedomedia0/Container-Cove'

export default defineConfig({
	title,
	titleTemplate: `:title — ${title}`,
	description,

	base: '/Container-Cove/',

	head: [
		['link', { rel: 'icon', type: 'image/png', href: '/Container-Cove/logo.png' }],
		['meta', { property: 'og:type', content: 'website' }],
		['meta', { property: 'og:title', content: title }],
		['meta', { property: 'og:url', content: url }],
		['meta', { property: 'og:description', content: description }],
		['meta', { name: 'twitter:card', content: 'summary_large_image' }],
		['meta', { name: 'twitter:title', content: title }],
		['meta', { name: 'twitter:description', content: description }],
		['meta', { name: 'theme-color', content: '#0d9488' }],
		['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
		['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
		['link', { href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@400;500;600;700&display=swap', rel: 'stylesheet' }],
	],

	appearance: 'force-dark',

	themeConfig: {
		logo: '/logo.png',

		nav: [
			{ text: 'Guide', link: '/guide/', activeMatch: '/guide/' },
			{ text: 'Install', link: '/guide/installation' },
			{
				text: 'Resources',
				items: [
					{ text: 'GitHub', link: github },
					{ text: 'Releases', link: `${github}/releases` },
				],
			},
		],

		editLink: {
			pattern: `${github}/edit/main/docs/:path`,
			text: 'Edit this page on GitHub',
		},

		socialLinks: [
			{ icon: 'github', link: github },
		],

		search: {
			provider: 'local',
		},

		sidebar: {
			'/guide/': [
				{
					text: 'Getting Started',
					collapsed: false,
					items: [
						{ text: 'Introduction', link: '/guide/' },
						{ text: 'Installation', link: '/guide/installation' },
						{ text: 'Quick Start', link: '/guide/quick-start' },
					],
				},
				{
					text: 'Features',
					collapsed: false,
					items: [
						{ text: 'App Launcher', link: '/guide/app-launcher' },
						{ text: 'Recommended Catalog', link: '/guide/catalog' },
						{ text: 'Docker Lifecycle', link: '/guide/docker-lifecycle' },
						{ text: 'Compose Import', link: '/guide/compose-import' },
						{ text: 'Web UI & Shortcuts', link: '/guide/web-ui' },
						{ text: 'System Tray', link: '/guide/system-tray' },
						{ text: 'Secrets & Security', link: '/guide/secrets' },
					],
				},
				{
					text: 'Development',
					collapsed: false,
					items: [
						{ text: 'Build from Source', link: '/guide/build' },
						{ text: 'Troubleshooting', link: '/guide/troubleshooting' },
					],
				},
			],
		},

		footer: {
			message: 'Released under the MIT License.',
			copyright: 'Copyright © 2026 Steven Azevedo',
		},
	},

	markdown: {
		theme: 'vitesse-dark',
	},

	vite: {
		plugins: [tailwindcss()],
	},
})
