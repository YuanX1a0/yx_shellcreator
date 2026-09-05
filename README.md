# yx_shellcreator

FiveM standalone 房屋与室内建造资源，使用 JavaScript、C# 。可作为房屋与室内系统的基础，为服务器二次开发和功能扩展提供支持。

## 主要功能

- 所有人都可以创建、进入和编辑房屋。
- 支持 GTA 原版室内、当前位置房产、空白建造空间和自定义 Shell。
- 支持地板、墙、门、楼梯和家具的放置、移动、旋转、删除、撤销与重做。
- 支持多个出入口、原版地图室内家具接管，以及可推开的实体门。
- 支持房屋天气与时间设置、JSON 导入和导出。
- 使用 oxmysql 保存房屋和物件数据。
- 不包含购买、租赁、钥匙、门锁权限或房主权限系统。

## 安装

依赖：`oxmysql`、OneSync。

将资源放入服务器资源目录，并在 `server.cfg` 中添加：

```cfg
ensure oxmysql
ensure yx_shellcreator
```

进入游戏后输入：

```text
/shellcreator
```

## 许可证

本项目使用 GNU GPL v3，详见 [LICENSE](LICENSE)。

