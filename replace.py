import os

def replace_string_in_file(file_path, old_string, new_string):
    with open(file_path, 'r') as file:
        filedata = file.read()

    if old_string in filedata:
        filedata = filedata.replace(old_string, new_string)
        with open(file_path, 'w') as file:
            file.write(filedata)

def replace_string_in_folder(folder_path, old_string, new_string, skip_folder, script_name):
    for root, dirs, files in os.walk(folder_path):
        if skip_folder in root.split(os.sep):
            # 跳过指定文件夹及其子文件夹
            continue
        for name in files:
            if '.' in name and not name.startswith('.') and name != script_name:
                file_path = os.path.join(root, name)
                replace_string_in_file(file_path, old_string, new_string)

folder_path = '/Users/yindongliang/Library/Mobile Documents/com~apple~CloudDocs/Blog'  # 获取当前工作目录
old_string = 'tcitry/Pictures/master'
new_string = 'tcitry/static/master'
skip_folder = '.trash'  # 指定要跳过的文件夹
script_name = os.path.basename(__file__)  # 获取当前脚本的文件名

replace_string_in_folder(folder_path, old_string, new_string, skip_folder, script_name)

