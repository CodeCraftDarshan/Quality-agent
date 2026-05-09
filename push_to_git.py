import os
import subprocess

def find_git():
    search_paths = [
        os.environ.get("PROGRAMFILES", "C:\\Program Files"),
        os.environ.get("PROGRAMFILES(X86)", "C:\\Program Files (x86)"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs")
    ]
    for path in search_paths:
        if not os.path.exists(path):
            continue
        for root, dirs, files in os.walk(path):
            if "git.exe" in files:
                full_path = os.path.join(root, "git.exe")
                if "\\cmd\\" in full_path.lower():
                    return full_path
    return None

def run_git_command(git_path, args, cwd):
    cmd = [git_path] + args
    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)
    if result.returncode != 0:
        print(f"Error: {result.stderr}")
    else:
        print(result.stdout)
    return result

def main():
    root_dir = r"C:\Users\Admin\OneDrive\Documents\ai_new"
    git_path = find_git()
    if not git_path:
        print("Git not found.")
        return

    print(f"Found Git at: {git_path}")

    commands = [
        ["init"],
        ["config", "--local", "user.email", "darsh@example.com"],
        ["config", "--local", "user.name", "DARSHAN-cod"],
        ["remote", "add", "origin", "https://github.com/DARSHAN-cod/ai.git"],
        ["add", "."],
        ["commit", "-m", "Initial commit of Agentic AI Quality Platform"],
        ["branch", "-M", "main"],
        ["push", "-u", "origin", "main"]
    ]

    for cmd in commands:
        res = run_git_command(git_path, cmd, root_dir)
        if res.returncode != 0 and cmd[0] == "push":
            print("Push failed. Authentication might be required.")

if __name__ == "__main__":
    main()
