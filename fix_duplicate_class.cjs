const fs = require('fs');

function processFile(filepath) {
    let content = fs.readFileSync(filepath, 'utf8');

    let oldContent;
    do {
        oldContent = content;
        // Merge adjacent class="a" class="b" into class="a b"
        content = content.replace(/class="([^"]*)"\s+class="([^"]*)"/g, 'class="$1 $2"');
    } while (content !== oldContent);

    fs.writeFileSync(filepath, content);
}

processFile('./index.html');
processFile('./orders.html');
processFile('./printshop.html');
