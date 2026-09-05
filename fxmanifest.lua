fx_version 'cerulean'
game 'gta5'

name 'yx_shellcreator'
author 'YuanX1a0'
description 'Standalone house and interior builder using JavaScript, C# and oxmysql'
version '1.10.0'

ui_page 'web/index.html'

files {
    'web/index.html',
    'web/style.css',
    'web/app.js',
    'client/catalog.js',
    'config/config.json',
    'config/catalog.json',
    'stream/*.ydr',
    'stream/*.ytd',
    'stream/*.ytyp',
    'stream/*.ybn',
    'server/bin/Newtonsoft.Json.dll'
}

data_file 'DLC_ITYP_REQUEST' 'stream/*.ytyp'

client_scripts { 'client/catalog.js', 'client/environment.js', 'client/client.js' }
server_script 'server/bin/yx_shellcreator.Server.net.dll'

dependencies {
    'oxmysql',
    '/onesync'
}
