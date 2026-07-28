# Granodiorite

[中文](README.zh.md)

Granodiorite is a mirror serving Minecraft game assets and installers of the popular modloaders[^1]. This is a part of the [Phenocryst](https://phenocryst.ferris.love) project, mainly for the [Phanerite Minecraft Launcher](https://phenocryst.ferris.love/phanerite).

[^1]: Popular modloaders: [Fabric](https://fabricmc.net), [NeoForge](https://neoforged.net), and [Forge](https://minecraftforge.net).

## What is this?

This is a mirror serving several assets player need to download to play Minecraft. Inspired by [BMCLAPI](https://bmclapidoc.bangbang93.com/), the largest and most popular Minecraft mirror in China, Granodiorite aims to help Chinese players download Minecraft assets more conveniently and faster.

## Why not BMCLAPI?

As the most popular Minecraft mirror in China, BMCLAPI serves **over 100M requests per day** while operating purely on donations. This is very concerning — and indeed, BMCLAPI's performance has increasingly degraded in recent days.

Based on this condition and the pratical need of a controllable Minecraft mirror owned by Phenocryst Project itself, this is why we make a new mirror.

## Where is this running?

Codebase in this repo (the router) is running on Cloudflare Workers, serving cached assets from Cloudflare R2.

## Why the name?

1. Granodiorite is [Phaneritic](https://phenocryst.ferris.love/phanerite).
2.

| ![Minecraft granite block](/assets/granite.png) | + | ![Minecraft diorite block](/assets/diorite.png) | = | **Granodiorite** |
| :-: | :-: | :-: | :-: | :-: |

### This name is too complex!

<!-- outdated oldschool joke about Create mod where andesite is everything's basic -->

You can also call it **Dreate**, because andesite is not phaneritic, nor does it appear in the name.
