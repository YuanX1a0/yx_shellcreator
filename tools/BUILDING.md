# 建筑模型构建与检查

运行时无需安装建模工具或联网。发行包只包含编译后的模型。

本地工具 `AssetCheck` 使用 CodeWalker.Core 读写资源二进制，未将它作为服务器依赖或打入发行包。
本次使用上游 `dexyfex/CodeWalker` 提交 `485d56bec00262ed7fa472261cce7bbc6202b96e`，置于 `tools/CodeWalker`。
上游源代码声明见其 `Readme_Src.txt` 和 `Notice.txt`；不要将此工具依赖视为本插件的同许可证代码。

`generate_build_kit.mjs` 生成 GLB 和同源 mesh JSON，使用 glTF 的 Y-up 坐标；编译器统一转换成 GTA 的 `(x,-z,y)`。
着色器和纹理取自原套件的本地转换结果 `tools/converted_v14c`，门使用 `tools/converted_v13`；不会上传文件。
编译器保持碰撞顶点相对于 GeometryCenter，避免量化时截断高于模型中心的台阶。

在资源根目录执行：

```powershell
node tools/generate_build_kit.mjs
dotnet run --project tools/AssetCheck -c Release -- --build . yx_stairs_oak yx_stairs_concrete yx_stairs_collision yx_spiral_oak yx_spiral_concrete yx_spiral_collision
dotnet run --project tools/AssetCheck -c Release -- --embed-doors .
dotnet run --project tools/AssetCheck -c Release -- --verify .
node tests/model-runtime.js
node tests/smoke.js
```

验证会重新读取实际 `.ydr`/`.ybn`/`.ytyp`，对两类楼梯的三个横向位置和二十个高度段执行射线检测，验证 720 个接触点的高度、朝向和楼梯标记。
这些检查不等同于真实 FiveM 人物动画、网络和原版 DLC 模型的兼容性验证。
