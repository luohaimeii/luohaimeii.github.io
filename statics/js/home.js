function SetTab(name, cursel) {
    for (var i = 1; i <= 4; i++) {
        var menu = document.getElementById(name + i);
        var menudiv = document.getElementById("con_" + name + "_" + i);
        if (i == cursel) {
            menu.className = "off";
            menudiv.style.display = "block";
        }
        else {
            menu.className = "";
            menudiv.style.display = "none";
        }
 
    }
}

