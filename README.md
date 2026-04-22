# Imperfect Shadow Maps (ISM) Real-Time GI Contribution

This repository contains the **GI-related implementation layers, shader programs, documentation, and code excerpts** from my implementation study of **Imperfect Shadow Maps (ISM)** for real-time global illumination.

The work was implemented on top of an **academic AR renderer base that already supported PBR shading and PCF shadow mapping**, and this repository intentionally **does not redistribute the full base renderer**. Instead, it focuses on the parts I personally implemented for the ISM-based indirect illumination pipeline. fileciteturn16file0L61-L67

\---

## Overview

This project was a seminar-driven implementation of the paper:

**Imperfect Shadow Maps for Efficient Computation of Indirect Illumination**  
Tobias Ritschel et al., SIGGRAPH Asia 2008

The goal was to reproduce and study a practical real-time GI pipeline that approximates indirect visibility by replacing expensive per-VPL shadow maps with **low-quality point-based depth maps**, then repairing holes through **Pull-Push**, and finally using them for **visibility-aware indirect lighting**. The paper’s main flow is organized as **1) VPL generation, 2) point-based depth maps, 3) Pull-Push hole filling, 4) shading**. fileciteturn16file0L17-L17

My implementation reproduces that pipeline in an OpenGL-based renderer and adapts it into a working real-time demo.

\---

## What I Implemented

### 1\. Reflective Shadow Map (RSM) generation

I implemented an RSM stage that stores not only depth, but also **position, normal, and flux** information from the light’s point of view. In my implementation, the RSM is a **512×512 single-view map for a spotlight**. fileciteturn16file0L13-L13 fileciteturn16file0L63-L63

### 2\. GPU-parallel VPL generation

Using the RSM, I generated **Virtual Point Lights (VPLs)** on the GPU. The seminar material explicitly notes that VPLs are generated in parallel on the GPU with a **compute shader**, and my implementation follows that structure. fileciteturn16file0L23-L23

### 3\. Point-based ISM construction

Instead of rendering a full shadow map per VPL with original scene geometry, I used a **point-based representation** to build many low-resolution imperfect shadow maps efficiently. The paper’s idea is that low-quality depth maps are sufficient for many faint VPLs, and my implementation follows that same simplification strategy. fileciteturn16file0L17-L17 fileciteturn16file0L24-L30

In my implementation:

* each ISM tile is **128×128**
* the full atlas is **4096×4096**
* I used a **2-level Pull-Push** reconstruction stage
* the point cloud preprocessing used **8K points for each VPL**, with about **250K total scene points** in the implementation notes. fileciteturn16file0L62-L66

### 4\. Pull-Push hole filling

Point-based depth maps naturally contain holes. I implemented a Pull-Push pyramid step to fill sparse regions, following the paper’s central idea of averaging valid values during pull, then propagating them back during push. My seminar implementation notes record this as a **2-level Pull-Push** stage on the ISM atlas. fileciteturn16file0L31-L34 fileciteturn16file0L64-L64

### 5\. Deferred shading with indirect visibility

I separated **direct** and **indirect** illumination and composed them afterward in a deferred-style pipeline, mirroring the shading flow described in the seminar material. fileciteturn16file0L35-L36 fileciteturn16file0L65-L65

### 6\. Interleaved VPL sampling + geometry-aware blur

For indirect illumination, I used **interleaved sampling**, lighting each fragment with **64 random VPLs out of 1024**, then filtered the resulting noise using a **5×5 geometry-aware cross bilateral filter**. These are the exact implementation parameters documented in the seminar slides. fileciteturn16file0L66-L66

\---

## Repository Scope

This repository is intentionally **not** a full runnable distribution of the original project.

It includes:

* GI-related shader programs that I wrote
* code excerpts showing the ISM pipeline integration
* seminar documentation / result images
* implementation notes for the ISM-specific stages

It intentionally excludes:

* the full academic base renderer
* framework-level engine code not authored by me
* third-party or lab-provided project structure
* packaged executable distribution

This separation is intentional because the original project was built on top of an academic renderer base, while this repository is meant to document **my contribution layer** only. The seminar notes also explicitly describe the project as being based on **AR Renderer with PBR shading and PCF shadow** already applied. fileciteturn16file0L61-L61

\---

## Included Files

### `Shaders/`

Core shader files for the GI pipeline:

* `rsm.vert`, `rsm.frag`
* `vpl.comp`
* `ism.vert`, `ism.frag`
* `pullpush.vert`, `pull.frag`, `push.frag`
* `blur.frag`

Additional helper / debug shaders:

* `point.vert`, `point.frag`

### `Code\_Excerpts/ism\_pipeline\_excerpt.cpp`

A focused excerpt of the pipeline integration code showing the core stages I implemented:

* RSM setup
* VPL compute dispatch
* ISM atlas rendering
* Pull-Push pass
* indirect-light composition path

### `Docs/`

Images captured from the seminar presentation and project results.

\---

## Pipeline Summary

The implemented pipeline is:

1. Render **RSM** from the spotlight view
2. Generate **VPLs** from RSM position / normal / flux
3. Build a **point-based ISM atlas** for many VPLs
4. Repair holes with **Pull-Push**
5. Shade indirect light using **interleaved VPL sampling**
6. Apply **geometry-aware cross bilateral blur**
7. Composite **direct + indirect** lighting

This mirrors the structure presented in the seminar slides: **VPL generation → point-based depth maps → Pull-Push → shading**. fileciteturn16file0L17-L17

\---

## Documentation Images

### Overview

<p align="center">
  <img src="Docs/Overview.png" width="80%" alt="Overview">
</p>

### Reflective Shadow Map (RSM)

The implementation stores the RSM textures needed for VPL generation, including **position**, **normal**, and **flux**. The seminar implementation slide summarizes this as a **512×512 single-view spotlight RSM**. fileciteturn16file0L63-L63

<p align="center">
  <img src="Docs/RSM.png" width="80%" alt="RSM">
</p>

### Point cloud processing

The scene is preprocessed into a point cloud so that many VPL-specific imperfect depth maps can be generated efficiently without re-rendering full geometry for every VPL. The seminar slide notes **8K points for each VPL** and roughly **250K total scene points** in the implementation. fileciteturn16file0L62-L62

<p align="center">
  <img src="Docs/point\_cloud\_processing.png" width="80%" alt="Point cloud processing">
</p>

### Pull-Push reconstruction

The Pull-Push step fills holes caused by sparse point-based depth maps. In the implementation notes, the atlas is **4096×4096**, each ISM tile is **128×128**, and a **2-level Pull-Push** stage is used. fileciteturn16file0L64-L64

<p align="center">
  <img src="Docs/pullpush\_compairsion.png" width="80%" alt="Pull-Push comparison">
</p>

### Interleaved sampling and blur

For shading, the implementation uses **64 random VPLs out of 1024 per fragment**, then applies a **5×5 geometry-aware cross bilateral filter** to reduce noise while preserving structure. fileciteturn16file0L66-L66

<p align="center">
  <img src="Docs/interleaved+blur.png" width="80%" alt="Interleaved sampling and geometry-aware blur">
</p>

### Final result

<p align="center">
  <img src="Docs/final\_result.png" width="80%" alt="Final result">
</p>

\---

## Performance

For the seminar demo implementation, the measured average performance was:

* **Average frame time:** **6.5 ms**
* **Average frame rate:** **153.8 FPS**
* **Resolution:** **1600×1200**
* **Hardware:** **5.3 GHz CPU + NVIDIA GeForce RTX 4070 Ti**
* **Lighting setup:** **single-bounce indirect illumination** fileciteturn16file0L67-L67

This is the implementation-side demo result, distinct from the original 2008 paper’s reported benchmark numbers. The seminar slides separately document the original paper’s performance on Christo’s Sponza as **89 ms / 11 fps** on an older 1.8 GHz CPU + GeForce 8800 GTX for a different experimental setting. fileciteturn16file0L40-L40

\---

## Notes on Quality and Limitations

The original method’s strength is that **inaccurate visibility has only minor visual impact** while giving major performance gains, because many faint VPLs collectively produce smooth low-frequency lighting. fileciteturn16file0L17-L17 fileciteturn16file0L68-L69

However, the method also has known limitations:

* good results require a sufficient number of point samples
* too few VPLs can lead to temporal flickering
* light leaking can still appear because ISMs only approximate low-frequency visibility fileciteturn16file0L68-L69

These limitations were important in understanding the trade-off between quality and scalability in real-time GI.

\---

## Why This Project Matters

This project was important to me because it was not just a shader exercise. It required:

* understanding a real-time GI paper deeply enough to reconstruct its pipeline
* converting the paper’s ideas into a working OpenGL renderer
* balancing quality and performance using point-based approximations
* implementing visibility-aware indirect lighting, not just simple additive bounce light
* explaining the architecture and limitations clearly in a seminar setting

In short, this project helped me develop the ability to move from **graphics papers → working renderer implementation → technical communication**.

\---

## Related Materials

* Portfolio PDF: \[add link]
* Seminar / demo video: \[add link]
* UE5 Custom SSGI repository: \[add link]
* Path Tracer repository: \[add link]

\---

## Contact

* GitHub: https://github.com/whlee503
* Email: whlee503@ajou.ac.kr

