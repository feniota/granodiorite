# Granodiorite

[服务条款](https://phenocryst.ferris.love/zh/granodiorite/terms.html)

花岗闪长岩（Granodiorite）是一个 Minecraft 游戏资源镜像，同时覆盖主流模组加载器[^1]的安装器文件。本项目是 [Phenocryst](https://phenocryst.ferris.love) 系统的一部分，主要为 [Phanerite 启动器](https://phenocryst.ferris.love/phanerite) 提供下载加速服务。

[^1]: 主流模组加载器：[Fabric](https://fabricmc.net)、[NeoForge](https://neoforged.net) 和 [Forge](https://minecraftforge.net)。

## 这是什么？

这是一个 Minecraft 资源镜像站，面向国内玩家，提供多种游戏必需资源的加速下载。灵感来源于 [BMCLAPI](https://bmclapidoc.bangbang93.com/)——国内最大、最流行的 Minecraft 镜像站。Granodiorite 的目标是让国内玩家更方便、更快速地下载 Minecraft 游戏资源。

## 为什么不用 BMCLAPI？

作为国内最流行的 Minecraft 镜像站，BMCLAPI 日均承载 **超过 1 亿次请求**，却完全依靠捐赠运营。这令人担忧——实际上 BMCLAPI 的表现在近期的确每况愈下。

基于此，加上 Phenocryst 项目需要一个可控的 Minecraft 镜像的现实需求，我们决定自建一个新的镜像。

## 运行在哪里？

本仓库的代码（路由层）运行在 Cloudflare Workers 上，缓存的资源文件存放在 Cloudflare R2 中。

## 名字的由来？

1. 花岗闪长岩是[显晶岩（Phanerite）](https://phenocryst.ferris.love/phanerite)的一种。
2.

| ![Minecraft 花岗岩](/assets/granite.png) | + | ![Minecraft 闪长岩](/assets/diorite.png) | = | **Granodiorite** |
| :-: | :-: | :-: | :-: | :-: |

### 名字太复杂了！

你也可以叫它**几械动历**，因为安山岩既不是显晶质、也不在名字里。
