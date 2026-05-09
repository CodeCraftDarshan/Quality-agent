import os
import re

count = 0
for root, dirs, files in os.walk('frontend'):
    for file in files:
        if file.endswith('.jsx'):
            path = os.path.join(root, file)
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()

            def replacer(match):
                global count
                tag = match.group(0)
                if 'onClick' not in tag and 'submit' not in tag:
                    count += 1
                    return tag.replace('<button', '<button onClick={() => alert(\"Coming soon!\")}')
                return tag
            
            new_content = re.sub(r'<button[\s\S]*?>', replacer, content)

            if new_content != content:
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(new_content)

print(f'Updated {count} buttons')
